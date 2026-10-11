"""Server list ping against a local fake server."""
import json
import socket
import threading

from src.diagnostic.server_ping import _packet, _read_varint, _varint, ping


def _fake_server(reply: bytes):
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)

    def serve():
        conn, _ = listener.accept()
        with conn:
            for _ in range(2):  # handshake, status request
                conn.recv(_read_varint(conn))
            conn.sendall(reply)
        listener.close()

    threading.Thread(target=serve, daemon=True).start()
    return listener.getsockname()[1]


def test_reads_version_and_players():
    status = json.dumps({"version": {"name": "Velocity 3"}, "players": {"online": 7, "max": 100}}).encode()
    port = _fake_server(_packet(0, _varint(len(status)) + status))
    result = ping("127.0.0.1", port, timeout=2)
    assert result.online and result.ip == "127.0.0.1"
    assert (result.version, result.players_online, result.players_max) == ("Velocity 3", 7, 100)


def test_garbage_reply_is_offline():
    port = _fake_server(_packet(0, _varint(4) + b"nope"))
    result = ping("127.0.0.1", port, timeout=2)
    assert not result.online and result.error


def test_closed_port_is_offline():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    assert not ping("127.0.0.1", port, timeout=2).online
