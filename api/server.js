require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs'); // Модуль для работы с файлами
const OpenAI = require('openai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const DB_FILE = 'database.json'; // Имя файла, куда сохраняем

// --- ФУНКЦИЯ ЗАПИСИ В JSON ---
function saveUserToJSON(uid) {
    let users = [];
    
    // 1. Если файл есть - читаем его
    if (fs.existsSync(DB_FILE)) {
        try {
            const data = fs.readFileSync(DB_FILE, 'utf8');
            users = JSON.parse(data);
        } catch (e) { console.error("Ошибка чтения базы:", e); }
    }

    // 2. Проверяем, есть ли уже такой юзер
    const exists = users.find(u => u.uid === uid);
    
    // 3. Если нет - добавляем
    if (!exists) {
        users.push({
            uid: uid,
            date: new Date().toLocaleString("ru-RU"), // Дата входа
            status: "User" // Можно потом менять на PRO вручную
        });

        // 4. Сохраняем обратно в файл
        fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
        console.log(`[DATABASE] Новый пользователь сохранен: ${uid}`);
    }
}

// --- API ДЛЯ СОХРАНЕНИЯ ---
app.post('/api/register', (req, res) => {
    const { uid } = req.body;
    if (uid) {
        saveUserToJSON(uid);
        res.json({ status: 'saved' });
    } else {
        res.status(400).json({ error: 'No UID' });
    }
});

// --- ЧАТ API ---
const SYSTEM_PROMPT = `ТЫ — FLUX AI. Разработчик: 1xCode. Стиль: Краткий.`;

app.post('/api/chat', async (req, res) => {
    try {
        const { message, file, isPro } = req.body;
        const model = isPro ? "gpt-4o" : "gpt-4o-mini"; 

        const messages = [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: file ? [{ type: "text", text: message || "..." }, { type: "image_url", image_url: { url: file } }] : message }
        ];

        const completion = await openai.chat.completions.create({
            model: model,
            messages: messages,
            max_tokens: 3000,
        });

        res.json({ reply: completion.choices[0].message.content });
    } catch (error) {
        res.status(500).json({ reply: "Ошибка сервера." });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on ${PORT}`));
