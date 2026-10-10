// EXPERIMENTAL TEST-ONLY worker session; NOT packaged or connected to personal Tunnel.
// MUST run inside a pre-existing, separately owned Windows Job Object. Its process
// descendants inherit that Job; this helper itself does not own a child Job.
// Stop() kills the root only; closing the OUTER Job is needed to kill descendants.
// Production needs per-session Job isolation and authenticated IPC before remote use.
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace MiceHole.SecurityExperiment
{
    public sealed class BoundedWorkerSession : IDisposable
    {
        private const int MIN_BUFFER = 1024;
        private const int MAX_BUFFER = 65536;
        private readonly Process process;
        private readonly ByteTail stdout;
        private readonly ByteTail stderr;
        private readonly Task stdoutPump;
        private readonly Task stderrPump;
        private readonly Timer timeout;
        private readonly DateTime startUtc;
        private readonly int maxRuntimeMs;
        private bool disposed;
        private int timedOut;
        private int cancelled;

        [DllImport("kernel32.dll")]
        private static extern IntPtr GetCurrentProcess();
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool IsProcessInJob(IntPtr processHandle, IntPtr jobHandle,
                                                   [MarshalAs(UnmanagedType.Bool)] out bool inJob);

        private BoundedWorkerSession(Process value, int cap, int limitMs)
        {
            process = value;
            stdout = new ByteTail(cap);
            stderr = new ByteTail(cap);
            maxRuntimeMs = limitMs;
            startUtc = DateTime.UtcNow;
            stdoutPump = Task.Run(() => Drain(value.StandardOutput.BaseStream, stdout));
            stderrPump = Task.Run(() => Drain(value.StandardError.BaseStream, stderr));
            timeout = new Timer(_ =>
            {
                try
                {
                    if (!process.HasExited)
                    {
                        Interlocked.Exchange(ref timedOut, 1);
                        process.Kill();
                    }
                }
                catch (ObjectDisposedException) {}
                catch (InvalidOperationException) {}
                catch (Win32Exception) {}
            }, null, limitMs, Timeout.Infinite);
        }

        public static BoundedWorkerSession StartFixedFixture(string executable, string arguments,
            string workingDirectory, int perStreamBytes, int maxRuntimeMs)
        {
            bool inJob = false;
            if (!IsProcessInJob(GetCurrentProcess(), IntPtr.Zero, out inJob) || !inJob)
                throw new InvalidOperationException("WORKER_NOT_IN_WINDOWS_JOB");
            if (perStreamBytes < MIN_BUFFER || perStreamBytes > MAX_BUFFER)
                throw new ArgumentOutOfRangeException("perStreamBytes");
            if (maxRuntimeMs < 1000 || maxRuntimeMs > 120000)
                throw new ArgumentOutOfRangeException("maxRuntimeMs");
            if (String.IsNullOrEmpty(arguments) || arguments.Length > 4096 ||
                String.IsNullOrEmpty(executable) || !Path.IsPathRooted(executable) ||
                !File.Exists(executable) || !Directory.Exists(workingDirectory))
                throw new ArgumentException("Invalid fixed CI command");
            // The TEST caller owns this fixed executable and arguments. Never treat
            // them as safe for arbitrary user/ChatGPT messages.
            var info = new ProcessStartInfo(executable, arguments);
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            info.RedirectStandardInput = false;
            info.WorkingDirectory = workingDirectory;
            foreach (System.Collections.DictionaryEntry v in Environment.GetEnvironmentVariables())
            {
                string k = (string)v.Key;
                if (k.IndexOf("CONTROL_PLANE", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    k.IndexOf("OPENAI", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    k.IndexOf("MICEHOLE_RUNTIME_KEY", StringComparison.OrdinalIgnoreCase) >= 0)
                    info.EnvironmentVariables.Remove(k);
            }
            Process proc = new Process();
            proc.StartInfo = info;
            try
            {
                if (!proc.Start()) throw new InvalidOperationException("Worker fixture launch failed");
                return new BoundedWorkerSession(proc, perStreamBytes, maxRuntimeMs);
            }
            catch { proc.Dispose(); throw; }
        }

        private static void Drain(Stream stream, ByteTail buffer)
        {
            var data = new byte[1024];
            try
            {
                int count;
                while ((count = stream.Read(data, 0, data.Length)) > 0)
                    buffer.Append(data, count);
            }
            catch (ObjectDisposedException) {}
            catch (IOException) {}
            finally { buffer.Finished = true; }
        }

        public bool Wait(int milliseconds)
        {
            Check();
            if (milliseconds < 0 || milliseconds > 120000)
                throw new ArgumentOutOfRangeException("milliseconds");
            bool exited = process.WaitForExit(milliseconds);
            if (exited)
            {
                // Drain both streams concurrently; never wait indefinitely if
                // a grandchild still holds an inherited output pipe.
                try { Task.WaitAll(new[] { stdoutPump, stderrPump }, 500); }
                catch (AggregateException) {}
            }
            return exited;
        }

        public void Stop()
        {
            Check();
            Interlocked.Exchange(ref cancelled, 1);
            if (!process.HasExited)
            {
                try { process.Kill(); } catch (InvalidOperationException) {}
            }
        }

        public WorkerSessionState Status()
        {
            Check();
            bool exited = process.HasExited;
            return new WorkerSessionState
            {
                Pid = process.Id,
                Running = !exited,
                ExitCode = exited ? (int?)process.ExitCode : null,
                TimedOut = Interlocked.CompareExchange(ref timedOut, 0, 0) != 0,
                CancelRequested = Interlocked.CompareExchange(ref cancelled, 0, 0) != 0,
                RuntimeMs = (long)(DateTime.UtcNow - startUtc).TotalMilliseconds,
                MaxRuntimeMs = maxRuntimeMs,
                StdoutBytesObserved = stdout.TotalBytes,
                StderrBytesObserved = stderr.TotalBytes
            };
        }

        public WorkerOutputSnapshot Output(int maxReturnBytes)
        {
            Check();
            if (maxReturnBytes < 1 || maxReturnBytes > MAX_BUFFER)
                throw new ArgumentOutOfRangeException("maxReturnBytes");
            return new WorkerOutputSnapshot
            {
                Stdout = stdout.TextTail(maxReturnBytes),
                Stderr = stderr.TextTail(maxReturnBytes),
                StdoutTruncated = stdout.TotalBytes > (long)Math.Min(stdout.Capacity, maxReturnBytes),
                StderrTruncated = stderr.TotalBytes > (long)Math.Min(stderr.Capacity, maxReturnBytes),
                StdoutBytesObserved = stdout.TotalBytes,
                StderrBytesObserved = stderr.TotalBytes,
                StdoutEof = stdout.Finished,
                StderrEof = stderr.Finished
            };
        }

        private void Check()
        {
            if (disposed) throw new ObjectDisposedException("BoundedWorkerSession");
        }

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            timeout.Dispose();
            try { if (!process.HasExited) process.Kill(); }
            catch (InvalidOperationException) {}
            try { Task.WaitAll(new[] { stdoutPump, stderrPump }, 300); }
            catch (AggregateException) {}
            process.Dispose();
        }

        private sealed class ByteTail
        {
            private readonly byte[] ring;
            private int next, stored;
            private long total;
            public int Capacity { get { return ring.Length; } }
            public bool Finished { get; set; }
            public long TotalBytes { get { lock (ring) return total; } }
            public ByteTail(int capacity) { ring = new byte[capacity]; }
            public void Append(byte[] bytes, int count)
            {
                lock (ring)
                {
                    for (int i = 0; i < count; i++)
                    {
                        ring[next] = bytes[i];
                        next = (next + 1) % ring.Length;
                        if (stored < ring.Length) stored++;
                    }
                    total += count;
                }
            }
            public string TextTail(int max)
            {
                lock (ring)
                {
                    int size = Math.Min(stored, max);
                    byte[] copy = new byte[size];
                    int first = (next - size + ring.Length) % ring.Length;
                    for (int i = 0; i < size; i++) copy[i] = ring[(first + i) % ring.Length];
                    return Encoding.UTF8.GetString(copy);
                }
            }
        }
    }

    public sealed class WorkerSessionState
    {
        public int Pid { get; set; }
        public bool Running { get; set; }
        public int? ExitCode { get; set; }
        public bool TimedOut { get; set; }
        public bool CancelRequested { get; set; }
        public long RuntimeMs { get; set; }
        public int MaxRuntimeMs { get; set; }
        public long StdoutBytesObserved { get; set; }
        public long StderrBytesObserved { get; set; }
    }
    public sealed class WorkerOutputSnapshot
    {
        public string Stdout { get; set; }
        public string Stderr { get; set; }
        public bool StdoutTruncated { get; set; }
        public bool StderrTruncated { get; set; }
        public long StdoutBytesObserved { get; set; }
        public long StderrBytesObserved { get; set; }
        public bool StdoutEof { get; set; }
        public bool StderrEof { get; set; }
    }
}
