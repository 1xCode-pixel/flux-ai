require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const HF_TOKEN = process.env.HF_TOKEN;

// --- ИЗМЕНЕНИЕ: Берем Zephyr 7B Beta ---
// Эта модель работает стабильнее всего на бесплатном тарифе
const MODEL_ID = "HuggingFaceH4/zephyr-7b-beta";

// Используем стандартный адрес (он работает для этой модели лучше всего)
const API_URL = `https://api-inference.huggingface.co/models/${MODEL_ID}`;

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
            return res.json({ reply: "⚠️ В бесплатном сервере анализ фото недоступен. Только текст." });
        }

        // Промпт для Zephyr (он любит формат <|system|>...<|user|>)
        const systemPart = isPro 
            ? "Ты Flux Ultra. Отвечай экспертно, на русском языке."
            : "Ты Flux Core. Отвечай кратко, на русском языке.";

        const payload = {
            inputs: `<|system|>\n${systemPart}</s>\n<|user|>\n${message}</s>\n<|assistant|>\n`,
            parameters: {
                max_new_tokens: 1024,
                temperature: 0.7,
                return_full_text: false
            }
        };

        const response = await fetch(API_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${HF_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errText = await response.text();
            // Если модель грузится (503)
            if (response.status === 503) {
                 return res.json({ reply: "🔄 Нейросеть просыпается... Повторите вопрос через 20 секунд." });
            }
            throw new Error(`HF Error ${response.status}: ${errText}`);
        }

        const result = await response.json();
        
        let replyText = "";
        if (Array.isArray(result) && result[0]) {
            replyText = result[0].generated_text;
        } else if (result.generated_text) {
            replyText = result.generated_text;
        } else {
            replyText = "Ошибка генерации.";
        }
        
        res.json({ reply: replyText });

    } catch (error) {
        console.error("Server Error:", error.message);
        res.status(500).json({ reply: `❌ Ошибка сервера: ${error.message}` });
    }
});

app.get('/', (req, res) => res.send("Flux AI (Zephyr Node) Ready"));

module.exports = app;
