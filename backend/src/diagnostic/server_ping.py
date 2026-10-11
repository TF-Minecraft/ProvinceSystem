"""Minecraft server list ping: the same status request the multiplayer screen sends."""

from __future__ import annotations

import json
import socket
import struct
from dataclasses import dataclass

# Any recent protocol number works: the proxy answers status requests from every version.
_PROTOCOL = 773
_MAX_RESPONSE = 1 << 20


@dataclass(frozen=True)
class ServerStatus:
    online: bool
    address: str
    ip: str | None = None
    version: str | None = None
    players_online: int | None = None
    players_max: int | None = None
    error: str | None = None


def _varint(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        out.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(out)


def _read_exact(sock: socket.socket, size: int) -> bytes:
    data = bytearray()
    while len(data) < size:
        chunk = sock.recv(size - len(data))
        if not chunk:
            raise ConnectionError("connection closed")
        data += chunk
    return bytes(data)


def _read_varint(sock: socket.socket) -> int:
    value = 0
    for shift in range(0, 35, 7):
        byte = _read_exact(sock, 1)[0]
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value
    raise ValueError("varint too long")


def _packet(packet_id: int, payload: bytes = b"") -> bytes:
    body = _varint(packet_id) + payload
    return _varint(len(body)) + body


def ping(host: str, port: int, timeout: float = 5.0) -> ServerStatus:
    address = f"{host}:{port}"
    try:
        ip = socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM)[0][4][0]
    except OSError:
        return ServerStatus(online=False, address=address, error="name not found")
    try:
        with socket.create_connection((ip, port), timeout=timeout) as sock:
            sock.settimeout(timeout)
            name = host.encode()
            handshake = _varint(_PROTOCOL) + _varint(len(name)) + name + struct.pack(">H", port) + _varint(1)
            sock.sendall(_packet(0, handshake) + _packet(0))
            length = _read_varint(sock)
            if length > _MAX_RESPONSE:
                raise ValueError("status response too large")
            _read_varint(sock)  # packet id
            size = _read_varint(sock)
            if size > length:
                raise ValueError("bad status response")
            status = json.loads(_read_exact(sock, size))
            if not isinstance(status, dict):
                raise ValueError("bad status response")
    except (OSError, ValueError, ConnectionError) as exc:
        return ServerStatus(online=False, address=address, ip=ip, error=str(exc) or type(exc).__name__)
    players = status.get("players") or {}
    return ServerStatus(
        online=True,
        address=address,
        ip=ip,
        version=(status.get("version") or {}).get("name"),
        players_online=players.get("online"),
        players_max=players.get("max"),
    )
