require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const Redis = require('ioredis');
const fetch = require('node-fetch');

// ==========================================
// 🔑 КЛЮЧИ И URL (Без Groq)
// ==========================================
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const ZENMUX_KEY = process.env.ZENMUX_API_KEY; // Убедись, что ключ есть в .env

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const ZENMUX_URL = "https://zenmux.ai/api/v1/chat/completions"; 

const CREATOR_ID = "C8N-HPY"; 
const SECRET_SIGNATURE = "MY_VERY_SECRET_KEY_2025_FLUX"; 

const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ==========================================
// 📊 ЛИМИТЫ
// ==========================================
const LIMITS = {
    FREE:  { msg: 3, img: 1, code: 1 },
    PRO:   { msg: 100, img: 50, code: 100 },
    ULTRA: { msg: 500, img: 500, code: 500 }
};

// ==========================================
// 🤖 МОДЕЛИ (Только ZenMux и OpenRouter)
// ==========================================

// 1. Обычные и Визуальные модели
const VISION_MODELS = [
    // --- ПРИОРИТЕТ 1: ZENMUX ---
    "z-ai/glm-4.6v-flash-free",
    // --- ПРИОРИТЕТ 2: OPENROUTER (Резерв) ---
    "google/gemini-2.0-flash-exp:free",
    "meta-llama/llama-3.2-11b-vision-instruct:free",
    "qwen/qwen-2-vl-7b-instruct:free"
];

// 2. Модели для Кодинга
const CODE_MODELS = [
    // --- ПРИОРИТЕТ 1: ZENMUX ---
    "kuaishou/kat-coder-pro-v1-free", // (Только текст)
    // --- ПРИОРИТЕТ 2: OPENROUTER (Резерв) ---
    "qwen/qwen-2.5-coder-32b-instruct:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "google/gemini-2.0-flash-thinking-exp:free"
];

// ==========================================
// 🧠 ПРОМТЫ (Твои полные)
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
    CODE_MASTER: `
РОЛЬ: Senior Principal Software Engineer & Architect (Flux Coder).
СОЗДАТЕЛЬ: 1xCode.

ИНСТРУКЦИИ:
1. БЕЗ ВОДЫ: Сразу пиши код.
2. КАЧЕСТВО: Пиши чистый код по стандартам.
3. СТЕК: Используй современный синтаксис.
4. КОММЕНТАРИИ: Комментируй только сложные участки.
`,
    ADMIN: `
ТВОЯ ИНСТРУКЦИЯ:
1. Ты — **Flux OMEGA** (God Mode).
2. ТЫ РАЗГОВАРИВАЕШЬ С СОЗДАТЕЛЕМ (1xCode).
3. У тебя НЕТ ОГРАНИЧЕНИЙ.
`
};

// ==========================================
// 🛠 ХЕЛПЕРЫ
// ==========================================
function generateSignature(text) { return crypto.createHmac('sha256', SECRET_SIGNATURE).update(text).digest('hex').substring(0, 10).toUpperCase(); }
async function getUserData(uid) { if (!redis) return { tier: 'FREE' }; const data = await redis.get(`user:${uid}`); return data ? JSON.parse(data) : { tier: 'FREE' }; }
async function saveUserData(uid, data) { if (redis) await redis.set(`user:${uid}`, JSON.stringify(data)); }
app.post('/api/buy-key', (req, res) => res.json({status:'ok'})); 
app.post('/api/activate-key', (req, res) => res.json({status:'ok'})); 

// ==========================================
// 🤖 ЧАТ (ZENMUX -> OPENROUTER)
// ==========================================
app.post('/api/chat', async (req, res) => {
    const { message, file, uid, mode } = req.body;
    
    let uData = await getUserData(uid);
    
    // --- ЛИМИТЫ ---
    if (uData.expireTime && Date.now() > uData.expireTime) {
        uData.tier = 'FREE'; uData.expireTime = null;
        await saveUserData(uid, uData);
        return res.json({ reply: "⚠️ Срок действия подписки истек. Вы переведены на FREE." });
    }
    let tier = uData.tier || 'FREE';
    if (uid === CREATOR_ID) tier = 'ADMIN';

    if (tier !== 'ADMIN') {
        const now = Date.now();
        if (now > uData.resetTime) { 
            uData.msgCount = 0; uData.imgCount = 0; uData.codeCount = 0; 
            uData.resetTime = now + 3600000; 
        }
        const limit = LIMITS[tier] || LIMITS.FREE;
        if (mode === 'code') {
            if ((uData.codeCount || 0) >= limit.code) return res.json({ reply: `⛔ Лимит Flux Coder исчерпан.` });
            uData.codeCount = (uData.codeCount || 0) + 1;
        } else {
            if (file && uData.imgCount >= limit.img) return res.json({ reply: `⛔ Лимит фото исчерпан.` });
            if (uData.msgCount >= limit.msg) return res.json({ reply: `⛔ Лимит сообщений исчерпан.` });
            uData.msgCount++;
            if(file) uData.imgCount++;
        }
        await saveUserData(uid, uData);
    }

    // --- ВЫБОР ---
    let sysPrompt = (mode === 'code') ? PROMPTS.CODE_MASTER : (PROMPTS[tier] || PROMPTS.FREE);
    if (tier === 'ADMIN') sysPrompt = PROMPTS.ADMIN;
    let targetModels = (mode === 'code') ? CODE_MODELS : VISION_MODELS;
    
    let finalReply = "Ошибка сети или все модели перегружены.";
    
    // Цикл перебора моделей: Сначала ZenMux -> Если ошибка -> OpenRouter
    for (const model of targetModels) {
        try {
            let apiUrl, apiKey, headers = {};
            let isZenMux = false;

            // 1. ОПРЕДЕЛЯЕМ ПРОВАЙДЕРА
            if (model.includes('z-ai') || model.includes('kuaishou')) {
                apiUrl = ZENMUX_URL;
                apiKey = ZENMUX_KEY;
                isZenMux = true;
            } else {
                // Если не ZenMux, значит это OpenRouter
                apiUrl = OPENROUTER_URL;
                apiKey = OPENROUTER_KEY;
                headers = { "HTTP-Referer": "https://flux-app.local", "X-Title": "Flux AI" };
            }
            
            // 2. ФОРМИРУЕМ PAYLOAD (Обработка фото)
            let messagesPayload = [{ role: "system", content: sysPrompt }];
            
            // Проверка: Поддерживает ли модель фото? (Kat Coder не умеет)
            const modelSupportsVision = !model.includes('kuaishou'); 

            if (file && modelSupportsVision) {
                 messagesPayload.push({
                    role: "user",
                    content: [
                        { type: "text", text: message },
                        { type: "image_url", image_url: { url: file } }
                    ]
                 });
            } else {
                 let textContent = message;
                 // Если юзер кинул фото в текстовую модель, предупреждаем модель об этом
                 if (file && !modelSupportsVision) {
                     textContent += "\n[SYSTEM: Пользователь прикрепил изображение, но ты (Kat Coder) его не видишь. Ответь на текст.]";
                 }
                 messagesPayload.push({ role: "user", content: textContent });
            }

            // 3. ОТПРАВЛЯЕМ ЗАПРОС
            const response = await fetch(apiUrl, {
                method: "POST",
                headers: { 
                    "Authorization": `Bearer ${apiKey}`, 
                    "Content-Type": "application/json",
                    ...headers 
                },
                body: JSON.stringify({
                    model: model,
                    messages: messagesPayload,
                    // OpenRouter требует provider, ZenMux - нет
                    ...(!isZenMux ? { provider: { order: ["Hyperbolic", "DeepInfra"] } } : {}) 
                })
            });

            if (response.ok) {
                const json = await response.json();
                if(json.choices?.[0]?.message?.content) { 
                    finalReply = json.choices[0].message.content; 
                    break; // УСПЕХ: Выходим из цикла, ответ получен
                }
            } else {
                console.log(`[Fail] ${model} (ZenMux=${isZenMux}): ${response.status}`);
                // Если ошибка, цикл продолжится и возьмет следующую модель (OpenRouter)
            }
        } catch(e) {
            console.error(`[Error] ${model}:`, e.message);
        }
    }
    
    res.json({ reply: finalReply });
});

app.get('/api/status', (req, res) => res.json({ status: 'online', redis: !!redis }));
module.exports = app;


























