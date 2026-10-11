# Cloudflare Worker

Альтернативный (полностью бесплатный, не нужно покупать использовать общий сервак 

##

1. включите впн или же используйте свой домен 
2. Создайте аккаунт в [Cloudflare](https://dash.cloudflare.com/) (или войдите в существующий)
	* **После создания аккаунта подтвердите почту с помощью письма, который вам пришел на email**
3. Слева в панели выберите `Compute` → `Workers & Pages`  
   <img width="250" height="768" alt="image" src="https://github.com/user-attachments/assets/d81e3522-045a-4e65-9c2e-5545b7ad409a" />

4. Нажмите сверху справа кнопку **`Create application`** → `Start with Hello World!` → `Deploy`  
   <img width="1406" height="193" alt="image" src="https://github.com/user-attachments/assets/7ac65944-8761-42a6-ab6d-ba5f9080c883" />  
   <img width="586" height="379" alt="image" src="https://github.com/user-attachments/assets/ff901439-c2a1-4867-95de-e11b82a37044" />  
   <img width="624" height="694" alt="image" src="https://github.com/user-attachments/assets/bb68d49a-166d-42a0-8fe2-bd2b16c0d066" />

5. Сверху справа нажмите кнопку **`Edit code`**, замените код слева на тот, [что находится внизу этой страницы](./CfWorker.md#код-workerа)
    * Если у вас не загружается код, то вы не выполнили первый пункт  
    <img width="911" height="117" alt="image" src="https://github.com/user-attachments/assets/6bcdf839-d776-47e9-9d18-ba0efdf53244" />  
	<img width="1027" height="512" alt="image" src="https://github.com/user-attachments/assets/daf131ed-82d5-40f0-a7eb-daeb598bea40" />


6. Нажмите сверху справа кнопку **`Deploy`**  
   <img width="415" height="138" alt="image" src="https://github.com/user-attachments/assets/58d8f83e-d8b5-40cf-a30f-741d7311047b" />

7. Скопируйте домен из поля справа и укажите его в настройках **Cloudflare Worker** (или через аргумент `--cfproxy-worker-domain`)
    * Пример домена: `random-symbols-1234.username.workers.dev`
	* **Можно указывать несколько доменов через запятую (или повторением аргумента `--cfproxy-worker-domain`)**
   <img width="414" height="182" alt="image" src="https://github.com/user-attachments/assets/4fb0b111-8026-4d17-b993-6c70ec37f1f5" />


### Код Worker'а
```javascript
/**
 * Anixis Watch Together - Cloudflare Worker
 * Сервер совместного синхронного просмотра для приложения Anixis (Android)
 *
 * Инструкция: https://github.com/ismailtu3455-prog/anixis-app/blob/main/manual.md
 */

const rooms = new Map(); // roomId -> Set<WebSocket>
const roomMeta = new Map(); // roomId -> { lastAction, lastPosition, isPlaying, episodeNumber, animeTitle }
const roomUsers = new Map(); // roomId -> Map<WebSocket, string>

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Health check для проверки связи из приложения Anixis
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

    // 2. Страница приглашения /join при переходе по ссылке
    if (url.pathname === "/join") {
      return new Response(renderJoinPage(url), {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }

    // 3. Веб-дашборд если открыли ссылку в обычном браузере
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response(renderWebDashboard(url), {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }

    // 4. WebSocket подключение к комнате
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

  // Синхронизация нового участника с текущим состоянием комнаты
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

  // Оповещение об общем количестве участников
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

      // Проверка уникальности ника в комнате
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
              text: "Ник \"" + requestedNick + "\" уже занят в этой комнате. Пожалуйста, укажите другой ник!"
            }));
          } catch (e) {}
          return;
        }
        usersInRoom.set(webSocket, requestedNick);
      }

      // Сохранение состояния воспроизведения
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
      } catch (err) {}
    }
  }
}

function renderJoinPage(url) {
  const roomId = url.searchParams.get("room") || "party";
  const title = url.searchParams.get("title") || "аниме";
  const ep = url.searchParams.get("ep") || "1";

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Приглашение в комнату Anixis</title>
  <style>
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0B0B10;
      color: #FFFFFF;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
      box-sizing: border-box;
    }
    .card {
      background: #14141E;
      border: 1px solid rgba(139, 92, 246, 0.3);
      border-radius: 24px;
      padding: 32px 24px;
      max-width: 420px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 40px rgba(0,0,0,0.6);
    }
    h1 { font-size: 24px; margin-bottom: 8px; color: #FFFFFF; }
    p { color: #9CA3AF; font-size: 14px; line-height: 1.5; margin-bottom: 24px; }
    .badge {
      display: inline-block;
      background: rgba(139, 92, 246, 0.2);
      color: #A78BFA;
      padding: 6px 14px;
      border-radius: 12px;
      font-weight: 600;
      margin-bottom: 20px;
      font-size: 13px;
    }
    .btn {
      display: block;
      width: 100%;
      padding: 14px;
      border-radius: 14px;
      background: linear-gradient(135deg, #8B5CF6, #6D28D9);
      color: #FFFFFF;
      font-weight: bold;
      text-decoration: none;
      font-size: 15px;
      box-sizing: border-box;
      transition: opacity 0.2s;
    }
    .btn:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Комната #${roomId} • Серия ${ep}</div>
    <h1>Приглашение в Anixis</h1>
    <p>Вас пригласили на совместный просмотр «${title}»! Откройте приложение Anixis, чтобы подключиться к синхронному плееру.</p>
    <a href="anixis://room?id=${roomId}" class="btn">Открыть в Anixis</a>
  </div>
</body>
</html>`;
}

function renderWebDashboard(url) {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Anixis Watch Together Server</title>
  <style>
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0B0B10;
      color: #FFFFFF;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
      box-sizing: border-box;
    }
    .box {
      background: #14141E;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 20px;
      padding: 32px 24px;
      max-width: 440px;
      text-align: center;
    }
    h2 { color: #8B5CF6; margin-top: 0; }
    p { color: #9CA3AF; font-size: 14px; line-height: 1.5; }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(34, 197, 94, 0.15);
      color: #4ADE80;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    .dot { width: 8px; height: 8px; background: #22C55E; border-radius: 50%; }
    code {
      background: #1A1A28;
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 12px;
      color: #A78BFA;
    }
  </style>
</head>
<body>
  <div class="box">
    <div class="status"><div class="dot"></div> Сервер активен и готов к работе</div>
    <h2>Anixis Watch Together</h2>
    <p>Это WebSocket-сервер совместного просмотра приложения <b>Anixis</b>.</p>
    <p>Для подключения укажите URL этого сервера в приложении в разделе «Румы».</p>
    <p>Проверка статуса: <code>/health</code></p>
  </div>
</body>
</html>`;
}
```
