// Offline test fixture only: no control-plane, keys or traffic beyond loopback.
using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
class FakeTunnel {
  static int Main(string[] argv) {
    try {
      if (argv.Length == 0 || argv[0] != "run") return 2;
      int port = int.Parse(Environment.GetEnvironmentVariable("MICEHOLE_STUB_PORT"));
      string marker = Environment.GetEnvironmentVariable("MICEHOLE_STUB_CRASH_MARKER");
      bool crash = false;
      if (!string.IsNullOrEmpty(marker) && !File.Exists(marker)) {
        File.WriteAllText(marker, "first-run");
        crash = true;
      }
      TcpListener listener = new TcpListener(IPAddress.Loopback, port);
      listener.Start();
      DateTime crashAt = DateTime.UtcNow.AddSeconds(7);
      while (true) {
        if (crash && DateTime.UtcNow >= crashAt) return 7;
        if (!listener.Pending()) { Thread.Sleep(70); continue; }
        using (TcpClient peer = listener.AcceptTcpClient()) {
          peer.ReceiveTimeout = 1000; peer.SendTimeout = 1000;
          using (NetworkStream stream = peer.GetStream()) {
            byte[] buffer = new byte[4096];
            int n = stream.Read(buffer, 0, buffer.Length);
            string request = Encoding.ASCII.GetString(buffer, 0, n);
            bool ready = request.StartsWith("GET /readyz");
            string body = ready ? "{\"ok\":true}" : "{\"ok\":false}";
            string header = (ready ? "HTTP/1.1 200 OK" : "HTTP/1.1 404 Not Found") + "\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: " + Encoding.ASCII.GetByteCount(body) + "\r\n\r\n";
            byte[] bytes = Encoding.ASCII.GetBytes(header + body);
            stream.Write(bytes, 0, bytes.Length);
          }
        }
      }
    } catch (Exception e) { Console.Error.WriteLine(e.GetType().Name); return 8; }
  }
}
