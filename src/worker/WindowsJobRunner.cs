// W2-B EXPERIMENTAL / CI ONLY. Never expose to the personal Tunnel.
// Launches a process suspended, assigns it to a Windows Job Object, then resumes.
// The job's kill-on-close flag covers descendants that remain in the job.
// No generic user-supplied command API or credential/IPC boundary is implemented here.
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace MiceHole.SecurityExperiment
{
    public sealed class WindowsJobRunner : IDisposable
    {
        private const uint CREATE_SUSPENDED = 0x00000004;
        private const uint CREATE_NO_WINDOW = 0x08000000;
        private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
        private const uint WAIT_TIMEOUT = 258;
        private const uint WAIT_OBJECT_0 = 0;
        private const int JobObjectExtendedLimitInformation = 9;
        private IntPtr job = IntPtr.Zero;
        private IntPtr process = IntPtr.Zero;
        private bool disposed;
        private bool completed;
        private int exitCode = -1;

        [StructLayout(LayoutKind.Sequential)]
        private struct IO_COUNTERS
        {
            public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
            public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass, SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit, JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed, PeakJobMemoryUsed;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct STARTUPINFO
        {
            public uint cb;
            public string lpReserved, lpDesktop, lpTitle;
            public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars;
            public uint dwFillAttribute, dwFlags;
            public short wShowWindow, cbReserved2;
            public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PROCESS_INFORMATION
        {
            public IntPtr hProcess, hThread;
            public uint dwProcessId, dwThreadId;
        }

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(IntPtr jobHandle, int infoClass, IntPtr info, uint length);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(IntPtr jobHandle, IntPtr processHandle);
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "CreateProcessW")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CreateProcess(
            string application, StringBuilder commandLine, IntPtr processAttributes,
            IntPtr threadAttributes, bool inheritHandles, uint creationFlags,
            IntPtr environment, string currentDirectory, ref STARTUPINFO startupInfo,
            out PROCESS_INFORMATION processInformation);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint ResumeThread(IntPtr threadHandle);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetExitCodeProcess(IntPtr handle, out uint code);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool TerminateJobObject(IntPtr handle, uint exitCode);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool TerminateProcess(IntPtr handle, uint exitCode);

        public uint ProcessId { get; private set; }
        public bool Completed { get { return completed; } }
        public int ExitCode { get { return exitCode; } }

        private WindowsJobRunner() {}

        private static Exception NativeError(string action)
        {
            return new Win32Exception(Marshal.GetLastWin32Error(), action);
        }

        public static WindowsJobRunner StartFixed(string executable, string arguments, string workingDirectory)
        {
            if (!Path.IsPathRooted(executable) || !File.Exists(executable))
                throw new ArgumentException("Explicit existing executable path required");
            if (!Directory.Exists(workingDirectory) || arguments == null || arguments.Length > 3500)
                throw new ArgumentException("Invalid fixed fixture command arguments/workdir");
            var instance = new WindowsJobRunner();
            PROCESS_INFORMATION pi = new PROCESS_INFORMATION();
            bool created = false, assigned = false;
            try
            {
                instance.job = CreateJobObject(IntPtr.Zero, null);
                if (instance.job == IntPtr.Zero) throw NativeError("CreateJobObject");
                var limit = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
                limit.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
                IntPtr buffer = Marshal.AllocHGlobal(size);
                try
                {
                    Marshal.StructureToPtr(limit, buffer, false);
                    if (!SetInformationJobObject(instance.job, JobObjectExtendedLimitInformation,
                                                 buffer, (uint)size))
                        throw NativeError("SetInformationJobObject");
                }
                finally { Marshal.FreeHGlobal(buffer); }
                var si = new STARTUPINFO();
                si.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFO));
                // Correctly supply explicit lpApplicationName and quote argv[0].
                var command = new StringBuilder("\"" + executable + "\" " + arguments);
                if (!CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero,
                                   false, CREATE_SUSPENDED | CREATE_NO_WINDOW,
                                   IntPtr.Zero, workingDirectory, ref si, out pi))
                    throw NativeError("CreateProcess(SUSPENDED)");
                created = true;
                // This is the essential ordering: no child executes before the Job assignment.
                if (!AssignProcessToJobObject(instance.job, pi.hProcess))
                    throw NativeError("AssignProcessToJobObject");
                assigned = true;
                instance.process = pi.hProcess;
                instance.ProcessId = pi.dwProcessId;
                if (ResumeThread(pi.hThread) == 0xffffffff)
                    throw NativeError("ResumeThread");
                return instance;
            }
            catch
            {
                if (created && !assigned) TerminateProcess(pi.hProcess, 1);
                instance.Dispose();
                throw;
            }
            finally { if (pi.hThread != IntPtr.Zero) CloseHandle(pi.hThread); }
        }

        public bool Wait(int milliseconds)
        {
            if (disposed) throw new ObjectDisposedException("WindowsJobRunner");
            if (milliseconds < 0 || milliseconds > 120000)
                throw new ArgumentOutOfRangeException("milliseconds");
            if (completed) return true;
            uint state = WaitForSingleObject(process, (uint)milliseconds);
            if (state == WAIT_TIMEOUT) return false;
            if (state != WAIT_OBJECT_0) throw NativeError("WaitForSingleObject");
            uint value;
            if (!GetExitCodeProcess(process, out value)) throw NativeError("GetExitCodeProcess");
            exitCode = unchecked((int)value);
            completed = true;
            return true;
        }

        public void Cancel()
        {
            if (disposed) throw new ObjectDisposedException("WindowsJobRunner");
            // Even if the root process exited, its descendants are still members of the job.
            if (!TerminateJobObject(job, 1)) throw NativeError("TerminateJobObject");
        }

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            // No job handle is inherited by the child (bInheritHandles=false).
            // Closing the last job handle terminates its remaining members.
            if (job != IntPtr.Zero) { CloseHandle(job); job = IntPtr.Zero; }
            if (process != IntPtr.Zero) { CloseHandle(process); process = IntPtr.Zero; }
        }
    }
}
