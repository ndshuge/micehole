// EXPERIMENTAL TEST-ONLY Windows ACL + kernel token verification.
// Not part of the public installer; does not execute arbitrary commands.
using System;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Threading.Tasks;

namespace MiceHole.SecurityExperiment
{
    public sealed class PipePeerResult
    {
        public bool Authorized { get; set; }
        public string ObservedSid { get; set; }
        public bool WorkerAcknowledged { get; set; }
    }
    public static class WindowsPipeAttestor
    {
        public static bool RejectSameUserClient()
        {
            string current = WindowsIdentity.GetCurrent().User.Value;
            string notCurrent = current == "S-1-5-19" ? "S-1-5-20" : "S-1-5-19";
            string pipeName = "MiceHole-CI-Negative-" + Guid.NewGuid().ToString("N");
            using (var server = Create(pipeName, current, notCurrent))
            {
                Task<int> client = Task.Run(() => {
                    using(var stream = new NamedPipeClientStream(
                        ".", pipeName, PipeDirection.InOut, PipeOptions.None,
                        TokenImpersonationLevel.Impersonation))
                    {
                        stream.Connect(3000);
                        stream.WriteByte(17);
                        stream.Flush();
                        return stream.ReadByte();
                    }
                });
                var response = AuthorizeOnce(server, notCurrent, 4000);
                return !response.Authorized && response.ObservedSid == current &&
                    client.Wait(3000) && client.Result == 0;
            }
        }
        public static NamedPipeServerStream Create(string pipeName, string brokerSid, string expectedWorkerSid)
        {
            if (String.IsNullOrWhiteSpace(pipeName) || pipeName.Length > 120)
                throw new ArgumentException("Invalid test pipe name");
            if (String.Equals(brokerSid, expectedWorkerSid, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Broker and Worker SID must differ");
            PipeSecurity security = new PipeSecurity();
            security.SetAccessRuleProtection(true, false);
            security.AddAccessRule(new PipeAccessRule(
                new SecurityIdentifier(brokerSid), PipeAccessRights.FullControl,
                AccessControlType.Allow));
            // Access limited to the expected service identity and owning Broker, no Everyone/Anonymous.
            security.AddAccessRule(new PipeAccessRule(
                new SecurityIdentifier(expectedWorkerSid),
                PipeAccessRights.ReadWrite, AccessControlType.Allow));
            return new NamedPipeServerStream(pipeName, PipeDirection.InOut, 1,
                PipeTransmissionMode.Byte, PipeOptions.None, 4096, 4096, security);
        }
        public static PipePeerResult AuthorizeOnce(
            NamedPipeServerStream server, string expectedWorkerSid, int timeoutMs)
        {
            if (timeoutMs < 1000 || timeoutMs > 15000) throw new ArgumentOutOfRangeException("timeoutMs");
            var result = new PipePeerResult();
            Task t = Task.Run(() => server.WaitForConnection());
            if (!t.Wait(timeoutMs))
            {
                server.Dispose();
                throw new TimeoutException("No authorized Worker connected within deadline");
            }
            // Windows requires at least one read from the client before impersonating the client.
            // Client-provided message bytes are never used as evidence of the Windows SID.
            if (server.ReadByte() != 17) throw new InvalidOperationException("Invalid request frame");
            server.RunAsClient(() => {
                using (WindowsIdentity id = WindowsIdentity.GetCurrent(true))
                {
                    if (id != null && id.User != null) result.ObservedSid = id.User.Value;
                }
            });
            result.Authorized = String.Equals(result.ObservedSid, expectedWorkerSid,
                StringComparison.OrdinalIgnoreCase);
            server.WriteByte(result.Authorized ? (byte)1 : (byte)0);
            server.Flush();
            if (result.Authorized) result.WorkerAcknowledged = server.ReadByte() == 35;
            return result;
        }
    }
}
