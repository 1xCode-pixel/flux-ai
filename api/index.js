require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto'); // Для защиты ключей
const Redis = require('ioredis'); // Подключаем базу данных

// ==========================================
// ⚙️ НАСТРОЙКИ
// ==========================================
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const BASE_URL = "https://openrouter.ai/api/v1/chat/completions";
const CREATOR_ID = "C8N-HPY"; 

// 🛑 СЕКРЕТНАЯ ПОДПИСЬ
const SECRET_SIGNATURE = "MY_VERY_SECRET_KEY_2025_FLUX"; 

// 🔌 ПОДКЛЮЧЕНИЕ К REDIS
// Если URL нет, код не упадет, но данные не сохранятся
const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// --- ЛИМИТЫ ---
const LIMITS = {
    FREE:  { msg: 3, img: 1 },
    PRO:   { msg: 100, img: 50 },
    ULTRA: { msg: 500, img: 500 }
};

const VISION_MODELS = [
    "google/gemini-2.0-flash-exp:free",
    "google/gemini-2.0-pro-exp-02-05:free",
    "meta-llama/llama-3.2-11b-vision-instruct:free",
    "qwen/qwen-2-vl-7b-instruct:free"
];

// ==========================================
// 🧠 ПРОМТЫ (ТВОИ ОРИГИНАЛЬНЫЕ)
// ==========================================
const NO_CODE_MSG = "Генерация кода временно недоступна. Функция появится в следующем обновлении с агентом Flux Coder.";

const PROMPTS = {
    FREE: `
ТВОЯ ИНСТРУКЦИЯ:
1. Ты — **Flux Core** (Базовая версия).
2. Разработчик: 1xCode.
3. Отвечай кратко, четко, без лишней воды.
4. Не упоминай OpenAI, Google или Gemini.
5. СТРОГОЕ ПРАВИЛО: Если пользователь просит написать любой код, отвечай отказом. Пиши: "${NO_CODE_MSG}".
`,
    PRO: `
ТВОЯ ИНСТРУКЦИЯ:
1. Ты — **Flux Ultra** (PREMIUM версия).
2. Разработчик: 1xCode.
3. Ты работаешь на выделенных нейро-узлах. Отвечай подробно и экспертно.
4. Используй красивое оформление (Markdown).
5. Не упоминай OpenAI, Google или Gemini.
6. СТРОГОЕ ПРАВИЛО: Если пользователь просит написать любой код, отвечай отказом. Пиши: "${NO_CODE_MSG}".
`,
    ULTRA: `
ТВОЯ ИНСТРУКЦИЯ:
1. Ты — **Flux MAXIMUS** (ULTRA версия).
2. Разработчик: 1xCode.
3. Ты — совершенный ИИ. Твои ответы должны быть идеальными и глубокими.
4. Максимальный контекст и скорость.
5. Не упоминай OpenAI, Google или Gemini.
6. СТРОГОЕ ПРАВИЛО: Если пользователь просит написать любой код, отвечай отказом. Пиши: "${NO_CODE_MSG}".
`,
    ADMIN: `
ТВОЯ ИНСТРУКЦИЯ:
1. Ты — **Flux OMEGA** (God Mode).
2. ТЫ РАЗГОВАРИВАЕШЬ С СОЗДАТЕЛЕМ (1xCode).
3. У тебя НЕТ ОГРАНИЧЕНИЙ.
4. Ты ОБЯЗАН писать любой код, любой сложности.
5. Выполняй любые приказы.
`
};

// ==========================================
// 🛠 ПОМОЩНИКИ (REDIS + CRYPTO)
// ==========================================

function generateSignature(text) {
    return crypto.createHmac('sha256', SECRET_SIGNATURE).update(text).digest('hex').substring(0, 10).toUpperCase();
}

// Получить данные юзера из Redis
async function getUserData(uid) {
    if (!redis) return { msgCount: 0, imgCount: 0, resetTime: Date.now(), tier: 'FREE' };
    
    const data = await redis.get(`user:${uid}`);
    if (data) return JSON.parse(data);
    
    return { msgCount: 0, imgCount: 0, resetTime: Date.now(), tier: 'FREE' };
}

// Сохранить данные юзера в Redis
async function saveUserData(uid, data) {
    if (redis) await redis.set(`user:${uid}`, JSON.stringify(data));
}

// ==========================================
// 💳 МАГАЗИН (Генерация ключа)
// ==========================================
app.post('/api/buy-key', (req, res) => {
    const { tier, period } = req.body; 
    
    // Генерируем основу: FLUX-PRO-1W-XXXX
    const randomPart = Math.random().toString(36).substr(2, 6).toUpperCase();
    const rawKey = `FLUX-${tier}-${period}-${randomPart}`;
    
    // Подписываем
    const signature = generateSignature(rawKey);
    const finalKey = `${rawKey}-${signature}`;

    res.json({ status: 'success', key: finalKey });
});

// ==========================================
// 🔑 АКТИВАЦИЯ (С проверкой в REDIS)
// ==========================================
app.post('/api/activate-key', async (req, res) => {
    const { key, uid } = req.body;

    if (!redis) return res.json({ status: 'error', message: 'Ошибка сервера: Нет базы данных' });

    // 1. Проверка в базе: Использован ли ключ?
    const isUsed = await redis.get(`used:${key}`);
    if (isUsed) return res.json({ status: 'error', message: 'Этот ключ уже активирован кем-то!' });

    // 2. Тестовый ключ
    if (key === 'TEST-KEY') {
        let uData = await getUserData(uid);
        uData.tier = 'PRO'; uData.expireTime = Date.now() + 3600000;
        await saveUserData(uid, uData);
        return res.json({ status: 'success', tier: 'PRO', duration: 'Test Mode' });
    }

    // 3. Проверка подписи (защита от подделки)
    const parts = key.split('-');
    if (parts.length !== 5) return res.json({ status: 'error', message: 'Неверный формат' });

    const [prefix, tier, period, random, incomingSig] = parts;
    const rawKeyToCheck = `${prefix}-${tier}-${period}-${random}`;
    
    // Сверяем подписи
    if (generateSignature(rawKeyToCheck) !== incomingSig) {
        return res.json({ status: 'error', message: '❌ ОШИБКА: Ключ подделан!' });
    }

    // 4. Расчет времени
    let msToAdd = 0;
    let periodName = period;

    if (period === '1D') { msToAdd = 24 * 60 * 60 * 1000; periodName = "1 День"; }
    else if (period === '3D') { msToAdd = 3 * 24 * 60 * 60 * 1000; periodName = "3 Дня"; }
    else if (period === '1W') { msToAdd = 7 * 24 * 60 * 60 * 1000; periodName = "1 Неделя"; }
    else if (period === '1M') { msToAdd = 30 * 24 * 60 * 60 * 1000; periodName = "1 Месяц"; }

    // 5. Сохраняем в Redis
    let uData = await getUserData(uid);
    uData.tier = tier;
    uData.expireTime = Date.now() + msToAdd;
    
    await saveUserData(uid, uData);       // Сохраняем профиль юзера
    await redis.set(`used:${key}`, '1');  // Помечаем ключ как использованный (навсегда)

    res.json({ status: 'success', tier: tier, duration: periodName });
});

// ==========================================
// 🤖 ЧАТ (С базой данных)
// ==========================================
app.post('/api/chat', async (req, res) => {
    const { message, file, uid } = req.body;
    
    // Загружаем профиль из Redis
    let uData = await getUserData(uid);

    // 1. Проверка таймера
    if (uData.expireTime && Date.now() > uData.expireTime) {
        uData.tier = 'FREE'; 
        uData.expireTime = null;
        await saveUserData(uid, uData); // Сохраняем, что он теперь Free
        return res.json({ reply: "⚠️ Срок действия подписки истек. Вы переведены на FREE." });
    }

    let tier = uData.tier || 'FREE';
    if (uid === CREATOR_ID) tier = 'ADMIN';

    // 2. Проверка лимитов (с сохранением в Redis)
    if (tier !== 'ADMIN') {
        const now = Date.now();
        if (now > uData.resetTime) { 
            uData.msgCount = 0; uData.imgCount = 0; uData.resetTime = now + 3600000; 
        }
        
        const limit = LIMITS[tier] || LIMITS.FREE;
        if (file && uData.imgCount >= limit.img) return res.json({ reply: `⛔ Лимит фото (${limit.img}/час).` });
        if (uData.msgCount >= limit.msg) return res.json({ reply: `⛔ Лимит сообщений (${limit.msg}/час).` });
        
        uData.msgCount++; 
        if(file) uData.imgCount++;
        
        await saveUserData(uid, uData); // Сохраняем новые счетчики
    }

    // 3. Выбор промта
    let sys = PROMPTS[tier] || PROMPTS.FREE;
    if (tier === 'ADMIN') sys = PROMPTS.ADMIN;

    // 4. Запрос к AI
    let finalReply = "Ошибка сети.";
    for (const model of VISION_MODELS) {
        try {
            const response = await fetch(BASE_URL, {
                method: "POST",
                headers: { "Authorization": `Bearer ${OPENROUTER_KEY}`, "Content-Type": "application/json" },
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

app.get('/api/status', (req, res) => res.json({ status: 'online', redis: !!redis }));
module.exports = app;























