require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const HF_TOKEN = process.env.HF_TOKEN;

// --- ИСПРАВЛЕНИЕ: БЕРЕМ MISTRAL v0.3 (ОНА ВСЕГДА ДОСТУПНА) ---
const MODEL_ID = "mistralai/Mistral-7B-Instruct-v0.3";

const API_URL = `https://router.huggingface.co/models/${MODEL_ID}`;

app.get('/api/status', (req, res) => {
    if (process.env.MAINTENANCE_MODE === 'true') res.json({ status: 'maintenance' });
    else res.json({ status: 'active' });
});

app.post('/api/register', (req, res) => res.json({ status: 'ok' }));

app.post('/api/chat', async (req, res) => {
    if (process.env.MAINTENANCE_MODE === 'true') {
        return res.status(503).json({ reply: "⛔ СЕРВЕР НА ОБСЛУЖИВАНИИ" });
    }

    try {
        const { message, file, isPro } = req.body;

        if (file) {
            return res.json({ reply: "⚠️ В бесплатной сервере анализ изображений временно недоступен. Отправьте текст." });
        }

        const systemPrompt = isPro 
            ? "Ты Flux Ultra. Отвечай экспертно, на русском языке. Используй Markdown."
            : "Ты Flux Core. Отвечай кратко, на русском языке.";

        // Формируем промпт специально для Mistral
        // Он любит формат [INST] ... [/INST]
        const finalPrompt = `<s>[INST] ${systemPrompt}\n\nВопрос: ${message} [/INST]`;

        const response = await fetch(API_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${HF_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                inputs: finalPrompt,
                parameters: {
                    max_new_tokens: 2048,
                    temperature: 0.7,
                    return_full_text: false
                }
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            // Если модель грузится (503), попробуем сказать об этом
            if (response.status === 503) {
                 return res.json({ reply: "🔄 Модель Flux запускается (холодный старт). Повторите вопрос через 20 секунд." });
            }
            throw new Error(`HF Error ${response.status}: ${errText}`);
        }

        const result = await response.json();
        
        let replyText = "";
        // Mistral обычно отдает массив
        if (Array.isArray(result) && result[0]) {
            replyText = result[0].generated_text;
        } else if (result.generated_text) {
            replyText = result.generated_text;
        } else {
            replyText = "Ошибка генерации (пустой ответ).";
        }
        
        res.json({ reply: replyText });

    } catch (error) {
        console.error("Server Error:", error.message);
        res.status(500).json({ reply: `❌ Ошибка сервера: ${error.message}` });
    }
});

app.get('/', (req, res) => res.send("Flux AI (Mistral Node) Ready"));

module.exports = app;

