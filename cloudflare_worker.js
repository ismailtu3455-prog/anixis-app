/**
 * Anixis Watch Together - Cloudflare Worker
 * Сервер совместного синхронного просмотра для приложения Anixis (Android)
 *
 * Бесплатное развертывание:
 * 1. Зайдите на https://dash.cloudflare.com
 * 2. Workers & Pages -> Create Application -> Create Worker
 * 3. Вставьте этот код целиком и нажмите "Deploy"
 * 4. Скопируйте ссылку воркера (например: https://my-room.yourname.workers.dev)
 * 5. Вставьте ссылку в приложении Anixis в разделе "Румы"
 *
 * Примечание: Для максимальной стабильности в РФ рекомендуется привязать
 * собственный домен в настройках воркера (Triggers -> Custom Domains).
 */

const rooms = new Map(); // roomId -> Set<WebSocket>
const roomMeta = new Map(); // roomId -> { lastAction, lastPosition, isPlaying, episodeNumber }
const roomUsers = new Map(); // roomId -> Map<WebSocket, string>

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Health check для проверки связи из приложения
    if (url.pathname === "/health" || url.pathname === "/api/health") {
      return new Response(JSON.stringify({
        status: "ok",
        service: "Anixis Watch Together Server",
        activeRooms: rooms.size,
        timestamp: Date.now()
      }), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    // 2. Если не WebSocket запрос, отдаем информационную панель
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response(renderWebDashboard(url), {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }

    // 3. Извлечение ID комнаты из пути: /room/:id или ?room=:id
    let roomId = url.pathname.replace(/^\/room\/?/, "").replace(/^\//, "");
    if (!roomId || roomId === "ws") {
      roomId = url.searchParams.get("room") || "general";
    }

    // 4. Создание WebSocket пары (Cloudflare Workers API)
    const webSocketPair = new WebSocketPair();
    const [clientSocket, serverSocket] = Object.values(webSocketPair);

    handleWebSocketSession(serverSocket, roomId);

    return new Response(null, {
      status: 101,
      webSocket: clientSocket
    });
  }
};

function handleWebSocketSession(webSocket, roomId) {
  webSocket.accept();

  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
  }
  const roomClients = rooms.get(roomId);
  roomClients.add(webSocket);

  // Отправляем текущее состояние комнаты новому клиенту (если есть)
  if (roomMeta.has(roomId)) {
    const meta = roomMeta.get(roomId);
    try {
      webSocket.send(JSON.stringify({
        action: "SYNC_INIT",
        position: meta.lastPosition || 0,
        isPlaying: meta.isPlaying || false,
        episodeNumber: meta.episodeNumber || 1,
        usersCount: roomClients.size
      }));
    } catch (e) {}
  }

  // Оповещаем остальных о количестве участников
  broadcastToRoom(roomId, {
    action: "USER_COUNT",
    count: roomClients.size
  }, null);

  webSocket.addEventListener("message", (event) => {
    try {
      const data = JSON.parse(event.data);
      const action = data.action;

      if (action === "PING") {
        try { webSocket.send(JSON.stringify({ action: "PONG" })); } catch (e) {}
        return;
      }

      if (action === "JOIN") {
        const requestedNick = (data.user || "Зритель").trim();
        if (!roomUsers.has(roomId)) {
          roomUsers.set(roomId, new Map());
        }
        const usersInRoom = roomUsers.get(roomId);
        let isTaken = false;
        for (const [ws, name] of usersInRoom.entries()) {
          if (ws !== webSocket && name.toLowerCase() === requestedNick.toLowerCase()) {
            isTaken = true;
            break;
          }
        }
        if (isTaken) {
          try {
            webSocket.send(JSON.stringify({
              action: "NICKNAME_TAKEN",
              user: requestedNick,
              text: "Ник \"" + requestedNick + "\" уже занят в этой комнате. Выберите другой ник!"
            }));
          } catch (e) {}
          return;
        }
        usersInRoom.set(webSocket, requestedNick);
      }

      // Обновляем метаданные комнаты при действиях воспроизведения
      if (action === "PLAY" || action === "PAUSE" || action === "SEEK" || action === "HEARTBEAT" || action === "EPISODE") {
        const meta = roomMeta.get(roomId) || {};
        if (data.position !== undefined) meta.lastPosition = data.position;
        if (data.isPlaying !== undefined) meta.isPlaying = data.isPlaying;
        if (data.episodeNumber !== undefined) meta.episodeNumber = data.episodeNumber;
        meta.lastAction = action;
        roomMeta.set(roomId, meta);
      }

      // Добавляем счетчик участников к сообщению, если нужно
      data.roomUsersCount = roomClients.size;

      // Транслируем всем остальным клиентам в комнате
      broadcastToRoom(roomId, data, webSocket);
    } catch (err) {
      // Игнорируем поврежденные пакеты
    }
  });

  const cleanup = () => {
    roomClients.delete(webSocket);
    if (roomUsers.has(roomId)) {
      const usersInRoom = roomUsers.get(roomId);
      usersInRoom.delete(webSocket);
      if (usersInRoom.size === 0) roomUsers.delete(roomId);
    }
    if (roomClients.size === 0) {
      rooms.delete(roomId);
      roomMeta.delete(roomId);
    } else {
      broadcastToRoom(roomId, {
        action: "USER_COUNT",
        count: roomClients.size
      }, null);
    }
  };

  webSocket.addEventListener("close", cleanup);
  webSocket.addEventListener("error", cleanup);
}

function broadcastToRoom(roomId, payload, excludeSocket) {
  const roomClients = rooms.get(roomId);
  if (!roomClients) return;

  const rawJson = typeof payload === "string" ? payload : JSON.stringify(payload);
  for (const client of roomClients) {
    if (client !== excludeSocket && client.readyState === WebSocket.READY_STATE_OPEN) {
      try {
        client.send(rawJson);
      } catch (err) {
        // Ошибка отправки конкретному клиенту
      }
    }
  }
}

function renderWebDashboard(url) {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Anixis Watch Together Hub</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0B0B10;
      color: #E2E8F0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 20px;
    }
    .card {
      background: #14141E;
      border: 1px solid rgba(139, 92, 246, 0.25);
      border-radius: 24px;
      max-width: 580px;
      width: 100%;
      padding: 32px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.6);
      text-align: center;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(34, 197, 94, 0.15);
      color: #4ADE80;
      border: 1px solid rgba(34, 197, 94, 0.3);
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 20px;
    }
    .badge-dot {
      width: 8px;
      height: 8px;
      background: #4ADE80;
      border-radius: 50%;
      box-shadow: 0 0 10px #4ADE80;
    }
    h1 {
      font-size: 26px;
      color: #FFFFFF;
      font-weight: 800;
      margin-bottom: 12px;
      letter-spacing: -0.5px;
    }
    .gradient-text {
      background: linear-gradient(135deg, #A78BFA, #8B5CF6);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p {
      color: #94A3B8;
      font-size: 14.5px;
      line-height: 1.6;
      margin-bottom: 24px;
    }
    .url-box {
      background: #1E1E2C;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 14px;
      padding: 14px;
      font-family: monospace;
      font-size: 14px;
      color: #C4B5FD;
      word-break: break-all;
      margin-bottom: 24px;
      user-select: all;
    }
    .tip {
      background: rgba(245, 158, 11, 0.1);
      border: 1px solid rgba(245, 158, 11, 0.3);
      border-radius: 14px;
      padding: 14px;
      font-size: 13px;
      color: #FCD34D;
      text-align: left;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">
      <div class="badge-dot"></div>
      Сервер синхронизации активен
    </div>
    <h1>Anixis <span class="gradient-text">Watch Together</span></h1>
    <p>
      Этот Cloudflare Worker обеспечивает синхронный просмотр видео, чат и реакции между пользователями приложения Anixis.
    </p>
    <div class="url-box">
      ${url.origin}
    </div>
    <div class="tip">
      💡 <b>Инструкция:</b> Скопируйте ссылку выше и вставьте её в приложение Anixis в разделе <b>Настройки → Румы</b>. Рекомендуется привязать свой домен в Cloudflare для работы в РФ без ограничений.
    </div>
  </div>
</body>
</html>`;
}
