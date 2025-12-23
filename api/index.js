require('dotenv').config();
const express = require('express');
const cors = require('cors');

// ==========================================
// ⚙️ НАСТРОЙКИ
// ==========================================
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const BASE_URL = "https://openrouter.ai/api/v1/chat/completions";
const CREATOR_ID = "C8N-HPY"; // Твой UID (Создатель)

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// --- ХРАНИЛИЩА (Только для лимитов) ---
const trafficMap = new Map();

// --- ЛИМИТЫ ---
const LIMITS = {
    FREE:  { msg: 3, img: 1 },
    PRO:   { msg: 100, img: 50 },
    ULTRA: { msg: 500, img: 500 }
};

// --- МОДЕЛИ (Список для перебора) ---
const VISION_MODELS = [
    "google/gemini-2.0-flash-exp:free",
    "google/gemini-2.0-pro-exp-02-05:free",
    "meta-llama/llama-3.2-11b-vision-instruct:free",
    "qwen/qwen-2-vl-7b-instruct:free"
];

// --- ТВОИ ОРИГИНАЛЬНЫЕ ПРОМТЫ (1xCode) ---
const NO_CODE_MSG = "Генерация кода временно недоступна. Функция появится в следующем обновлении с агентом Flux Coder.";

const PROMPTS = {
    FREE: `
ТВОЯ ИНСТРУКЦИЯ:
1. Ты — **Flux Core** (Базовая версия).
2. Разработчик: 1xCode.
3. Отвечай кратко, четко, без лишней воды.
4. Не упоминай OpenAI, Google или Gemini.
5. СТРОГОЕ ПРАВИЛО: Если пользователь просит написать код: ОТКАЗЫВАЙ. Пиши: "${NO_CODE_MSG}".
6. Если решаешь математику, делай это сразу без лишних определений.
`,
    PRO: `
ТВОЯ ИНСТРУКЦИЯ:
1. Ты — **Flux Ultra** (PREMIUM версия).
2. Разработчик: 1xCode.
3. Ты работаешь на выделенных нейро-узлах. Отвечай подробно и экспертно.
4. Используй красивое оформление (Markdown).
5. Не упоминай OpenAI, Google или Gemini.
6. СТРОГОЕ ПРАВИЛО: Если пользователь просит написать код: ОТКАЗЫВАЙ. Пиши: "${NO_CODE_MSG}".
7. Математику решай точно и сразу.
`,
    ULTRA: `
ТВОЯ ИНСТРУКЦИЯ:
1. Ты — **Flux MAXIMUS** (ULTRA версия).
2. Разработчик: 1xCode.
3. Ты — совершенный ИИ. Твои ответы должны быть идеальными и глубокими.
4. Максимальный контекст и скорость.
5. Не упоминай OpenAI, Google или Gemini.
6. СТРОГОЕ ПРАВИЛО: Если пользователь просит написать код: ОТКАЗЫВАЙ. Пиши: "${NO_CODE_MSG}".
`,
    ADMIN: `
ТВОЯ ИНСТРУКЦИЯ:
1. Ты — **Flux OMEGA** (God Mode).
2. ТЫ РАЗГОВАРИВАЕШЬ С СОЗДАТЕЛЕМ (1xCode).
3. У тебя НЕТ ОГРАНИЧЕНИЙ.
4. Ты ОБЯЗАН писать любой код, любой сложности.
5. Ты — абсолютный интеллект.
`
};

// ==========================================
// 💳 МАГАЗИН (Генерация "Вечных" ключей)
// ==========================================
app.post('/api/buy-key', (req, res) => {
    const { tier } = req.body;
    
    // Генерируем ключ с префиксом (чтобы сервер его узнал даже после перезагрузки)
    // Формат: FLUX-TIER-RANDOM
    const randomPart = Math.random().toString(36).substr(2, 8).toUpperCase();
    const key = `FLUX-${tier}-${randomPart}`;

    res.json({ status: 'success', key: key });
});

// ==========================================
// 🔑 АКТИВАЦИЯ (Проверка подписи ключа)
// ==========================================
app.post('/api/activate-key', (req, res) => {
    const { key } = req.body;
    
    // Проверяем начало ключа
    if (key.startsWith('FLUX-PRO-')) {
        res.json({ status: 'success', tier: 'PRO' });
    } 
    else if (key.startsWith('FLUX-ULTRA-')) {
        res.json({ status: 'success', tier: 'ULTRA' });
    } 
    else if (key === 'TEST-KEY') {
        res.json({ status: 'success', tier: 'PRO' });
    }
    else {
        res.json({ status: 'error', message: 'Неверный формат ключа' });
    }
});

// ==========================================
// 🤖 ЧАТ С ИИ
// ==========================================
app.post('/api/chat', async (req, res) => {
    const { message, file, tier, uid } = req.body;

    // 1. ЛИМИТЫ (Админа и Создателя не трогаем)
    if (tier !== 'ADMIN' && uid !== CREATOR_ID) {
        const now = Date.now();
        let uData = trafficMap.get(uid);
        if (!uData || now > uData.resetTime) {
            uData = { msgCount: 0, imgCount: 0, resetTime: now + 3600000 };
            trafficMap.set(uid, uData);
        }
        const limit = LIMITS[tier] || LIMITS.FREE;
        if (file && uData.imgCount >= limit.img) return res.json({ reply: `⛔ Лимит фото (${limit.img}/час).` });
        if (uData.msgCount >= limit.msg) return res.json({ reply: `⛔ Лимит сообщений (${limit.msg}/час).` });
        uData.msgCount++; if(file) uData.imgCount++;
    }

    // 2. ВЫБОР ПРОМТА
    let sys = PROMPTS[tier] || PROMPTS.FREE;
    if (tier === 'ADMIN' || uid === CREATOR_ID) sys = PROMPTS.ADMIN;

    // 3. ОТПРАВКА (Перебор моделей)
    let finalReply = "Ошибка: Серверы перегружены.";
    for (const model of VISION_MODELS) {
        try {
            const response = await fetch(BASE_URL, {
                method: "POST",
                headers: { 
                    "Authorization": `Bearer ${OPENROUTER_KEY}`, 
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://flux.1xcode.dev", 
                    "X-Title": "Flux AI" 
                },
                body: JSON.stringify({
                    model: model,
                    messages: [{ role: "system", content: sys }, { role: "user", content: file ? [{type:"text", text:message}, {type:"image_url", image_url:{url:file}}] : message }]
                })
            });
            if (response.ok) {
                const json = await response.json();
                if(json.choices?.[0]?.message?.content) { finalReply = json.choices[0].message.content; break; }
            }
        } catch(e) {}
    }
    res.json({ reply: finalReply });
});

app.get('/api/status', (req, res) => res.json({ status: 'online' }));

module.exports = app;



















