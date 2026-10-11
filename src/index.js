/**
 * Anixis Watch Together - Cloudflare Worker
 * Официальный сервер совместного просмотра для приложения Anixis
 * Поддерживает WebSockets, синхронизацию плеера, Heartbeat, чат, реакции и приглашения по ссылкам (/join).
 */

const rooms = new Map(); // roomId -> Set<WebSocket>
const roomMeta = new Map(); // roomId -> { lastAction, lastPosition, isPlaying, episodeNumber, animeTitle }

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

    // 2. Страница приглашения /join (когда друг переходит по ссылке из Telegram/WhatsApp)
    if (url.pathname === "/join") {
      return new Response(renderJoinPage(url), {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }

    // 3. Главная страница сервера
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response(renderWebDashboard(url), {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }

    // 4. WebSocket подключение к комнате: /room/:id или ?room=:id
    let roomId = url.pathname.replace(/^\/room\/?/, "").replace(/^\//, "");
    if (!roomId || roomId === "ws") {
      roomId = url.searchParams.get("room") || "general";
    }

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

  // Отправляем текущее состояние комнаты новому участнику
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

  // Оповещаем остальных об изменении количества участников
  broadcastToRoom(roomId, {
    action: "USER_COUNT",
    count: roomClients.size
  }, null);

  webSocket.addEventListener("message", (event) => {
    try {
      const data = JSON.parse(event.data);
      const action = data.action;

      if (action === "PLAY" || action === "PAUSE" || action === "SEEK" || action === "HEARTBEAT" || action === "EPISODE") {
        const meta = roomMeta.get(roomId) || {};
        if (data.position !== undefined) meta.lastPosition = data.position;
        if (data.isPlaying !== undefined) meta.isPlaying = data.isPlaying;
        if (data.episodeNumber !== undefined) meta.episodeNumber = data.episodeNumber;
        meta.lastAction = action;
        roomMeta.set(roomId, meta);
      }

      data.roomUsersCount = roomClients.size;
      broadcastToRoom(roomId, data, webSocket);
    } catch (err) {}
  });

  const cleanup = () => {
    roomClients.delete(webSocket);
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
      } catch (err) {}
    }
  }
}

function renderJoinPage(url) {
  const roomId = url.searchParams.get("room") || "general";
  const animeId = url.searchParams.get("animeId") || "0";
  const animeTitle = url.searchParams.get("animeTitle") || "Аниме";
  const server = url.origin;

  const deepLink = `anixis://room?server=${encodeURIComponent(server)}&room=${encodeURIComponent(roomId)}&animeId=${encodeURIComponent(animeId)}&title=${encodeURIComponent(animeTitle)}`;
  const downloadUrl = `https://github.com/ismailtu3455-prog/anixis-app/releases/latest/download/anixis-release.apk`;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Приглашение в комнату Anixis</title>
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
      border: 1px solid rgba(139, 92, 246, 0.35);
      border-radius: 26px;
      max-width: 480px;
      width: 100%;
      padding: 32px;
      box-shadow: 0 24px 48px rgba(0,0,0,0.7);
      text-align: center;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(139, 92, 246, 0.15);
      color: #A78BFA;
      border: 1px solid rgba(139, 92, 246, 0.3);
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 20px;
    }
    h1 {
      font-size: 24px;
      color: #FFFFFF;
      font-weight: 800;
      margin-bottom: 8px;
    }
    .anime-title {
      color: #C4B5FD;
      font-size: 17px;
      font-weight: 700;
      margin-bottom: 20px;
      word-break: break-word;
    }
    p {
      color: #94A3B8;
      font-size: 14px;
      line-height: 1.6;
      margin-bottom: 26px;
    }
    .btn-main {
      display: block;
      width: 100%;
      background: linear-gradient(135deg, #8B5CF6, #6D28D9);
      color: #FFFFFF;
      text-decoration: none;
      font-size: 16px;
      font-weight: 700;
      padding: 16px;
      border-radius: 16px;
      margin-bottom: 12px;
      box-shadow: 0 10px 20px rgba(139, 92, 246, 0.35);
      transition: transform 0.15s;
    }
    .btn-main:active { transform: scale(0.98); }
    .btn-sub {
      display: block;
      width: 100%;
      background: #1E1E2C;
      color: #E2E8F0;
      text-decoration: none;
      font-size: 14px;
      font-weight: 600;
      padding: 14px;
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">🍿 Совместный просмотр</div>
    <h1>Вас пригласили в руму!</h1>
    <div class="anime-title">${animeTitle}</div>
    <p>Комната: <b>${roomId}</b><br>Нажмите кнопку ниже, чтобы открыть приложение и смотреть синхронно с друзьями.</p>
    
    <a href="${deepLink}" class="btn-main" id="joinBtn">▶ Открыть в приложении Anixis</a>
    <a href="${downloadUrl}" class="btn-sub">Скачать Anixis (если нет приложения)</a>
  </div>

  <script>
    // Автоматическая попытка перехода в приложение
    setTimeout(function() {
      window.location.href = "${deepLink}";
    }, 600);
  </script>
</body>
</html>`;
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
      Сервер совместного просмотра Anixis готов к работе!
    </p>
    <div class="url-box">${url.origin}</div>
    <div class="tip">
      💡 Скопируйте ссылку выше и вставьте в приложение Anixis в разделе <b>Настройки → Румы</b>.
    </div>
  </div>
</body>
</html>`;
}
