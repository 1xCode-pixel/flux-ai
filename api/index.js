require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@vercel/kv');

const app = express();
app.use(cors());
// Ограничиваем размер файла 4MB, чтобы Vercel не падал
app.use(express.json({ limit: '4mb' }));

// --- КОНФИГУРАЦИЯ ---
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const BASE_URL = "https://openrouter.ai/api/v1/chat/completions";

// Подключаем базу (Раз у тебя Auth 200, значит тут все ок)
const kv = createClient({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

const MODELS = [
    "google/gemini-2.0-flash-exp:free",
    "meta-llama/llama-3.2-11b-vision-instruct:free"
];

// --- СТАТУС ---
app.get('/api/status', (req, res) => res.json({ status: 'active' }));

// --- AUTH (Работает, не трогаем) ---
app.post('/api/auth', async (req, res) => {
    try {
        const { uid } = req.body;
        const userKey = `user:${uid}`;
        let user = await kv.hgetall(userKey);
        if (!user) {
            user = { uid, isPro: false, proExpiry: 0 };
            await kv.hset(userKey, user);
        }
        res.json({ status: 'ok', isPro: user.isPro, expiry: user.proExpiry });
    } catch (e) {
        console.error(e);
        res.json({ status: 'ok', isPro: false });
    }
});

// --- HISTORY (Работает, не трогаем) ---
app.post('/api/history', async (req, res) => {
    try {
        const { uid } = req.body;
        const chatIds = await kv.lrange(`chats:${uid}`, 0, 15);
        let chats = [];
        for (const chatId of chatIds) {
            const chat = await kv.get(`chat:${uid}:${chatId}`);
            if (chat) chats.push(chat);
        }
        res.json({ chats });
    } catch (e) { res.json({ chats: [] }); }
});

// --- CHAT DELETE ---
app.post('/api/chat/delete', async (req, res) => {
    const { uid, chatId } = req.body;
    await kv.del(`chat:${uid}:${chatId}`);
    await kv.lrem(`chats:${uid}`, 0, chatId);
    res.json({ status: 'ok' });
});

// --- CHAT (ЗДЕСЬ БЫЛА ОШИБКА 500) ---
app.post('/api/chat', async (req, res) => {
    console.log("--> Start Chat Request");

    // 1. ПРОВЕРКА КЛЮЧА
    if (!OPENROUTER_KEY) {
        console.error("ERROR: No API Key");
        return res.json({ reply: "❌ ОШИБКА СЕРВЕРА: Не введен OPENROUTER_API_KEY в настройках Vercel." });
    }

    try {
        const { message, file, uid, chatId, chatTitle } = req.body;

        // 2. СБОРКА СООБЩЕНИЯ
        let messages = [
            { role: "system", content: "Ты Flux AI. Отвечай кратко." },
            { role: "user", content: [{ type: "text", text: message || "Анализ" }] }
        ];

        if (file) {
            messages[1].content.push({ type: "image_url", image_url: { url: file } });
        }

        // 3. ЗАПРОС С ТАЙМЕРОМ (Чтобы не было 500)
        let replyText = null;
        try {
            const controller = new AbortController();
            // Ставим 9 секунд. Если дольше - отменяем сами, чтобы Vercel не упал
            const timeout = setTimeout(() => controller.abort(), 9000);

            console.log("--> Sending to OpenRouter...");
            const response = await fetch(BASE_URL, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${OPENROUTER_KEY}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://flux-ai.vercel.app", 
                    "X-Title": "Flux AI"
                },
                body: JSON.stringify({
                    model: MODELS[0], 
                    messages: messages,
                    max_tokens: 1000
                }),
                signal: controller.signal
            });
            clearTimeout(timeout);

            if (response.ok) {
                const data = await response.json();
                replyText = data.choices?.[0]?.message?.content;
            } else {
                const err = await response.text();
                console.error("OpenRouter Error:", err);
                return res.json({ reply: `⚠️ Ошибка от OpenRouter: ${response.status}` });
            }
        } catch (fetchError) {
            console.error("Fetch Error:", fetchError.name);
            if (fetchError.name === 'AbortError') {
                return res.json({ reply: "⏳ Тайм-аут: Нейросеть отвечала слишком долго (>9 сек). Попробуйте еще раз." });
            }
            return res.json({ reply: "⚠️ Ошибка соединения с нейросетью." });
        }

        if (!replyText) return res.json({ reply: "⚠️ Пустой ответ." });

        // 4. СОХРАНЕНИЕ (В фоне)
        if (uid && chatId) {
            const chatKey = `chat:${uid}:${chatId}`;
            const chatData = (await kv.get(chatKey)) || { id: chatId, title: chatTitle, msgs: [] };
            if (chatData.msgs.length === 0) await kv.lpush(`chats:${uid}`, chatId);
            
            // Сохраняем без картинки (экономия места)
            chatData.msgs.push({ role: 'user', text: message, file: file ? 'image' : null });
            chatData.msgs.push({ role: 'ai', text: replyText });
            
            // Не ждем await, чтобы ответ ушел быстрее
            kv.set(chatKey, chatData); 
        }

        res.json({ reply: replyText });

    } catch (error) {
        console.error("CRITICAL:", error);
        // Вместо 500 отдаем текст ошибки пользователю
        res.json({ reply: `❌ CRITICAL ERROR: ${error.message}` });
    }
});

app.get('/', (req, res) => res.send("Flux AI Debug Ready"));
module.exports = app;
