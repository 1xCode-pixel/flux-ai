const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ТОЛЬКО РЕАЛЬНЫЕ :free МОДЕЛИ (БЕЗ Claude и DeepSeek R1!)
const MODELS = [
    // БЕСПЛАТНЫЕ НА САЙТЕ (3 худшие)
    {id: 'mistralai/mistral-7b-instruct:free', name: 'Mistral 7B', siteFree: true, vision: false},
    {id: 'google/gemma-2-9b-it:free', name: 'Gemma 2 9B', siteFree: true, vision: false},
    {id: 'meta-llama/llama-3.2-11b-vision-instruct:free', name: 'Llama 3.2 11B Vision', siteFree: true, vision: true},

    // ЗА ТОКЕНЫ (лучше, все :free на OpenRouter)
    {id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B', siteFree: false, vision: false},
    {id: 'mistralai/mixtral-8x7b-instruct:free', name: 'Mixtral 8x7B', siteFree: false, vision: false},
    {id: 'meta-llama/llama-3-8b-instruct:free', name: 'Llama 3 8B', siteFree: false, vision: false},
    {id: 'google/gemma-3-27b-it:free', name: 'Gemma 3 27B', siteFree: false, vision: false},
    {id: 'qwen/qwen-2.5-coder-32b-instruct:free', name: 'Qwen 2.5 Coder 32B', siteFree: false, vision: false},
    {id: 'google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash', siteFree: false, vision: true},
    {id: 'meta-llama/llama-3.2-90b-vision-instruct:free', name: 'Llama 3.2 90B Vision', siteFree: false, vision: true},
    {id: 'google/gemini-pro-1.5:free', name: 'Gemini Pro 1.5', siteFree: false, vision: false}
];

// API: Получить список моделей
app.get('/api/models', (req, res) => {
    res.json({ 
        models: MODELS,
        total: MODELS.length,
        free: MODELS.filter(m => m.siteFree).length,
        paid: MODELS.filter(m => !m.siteFree).length
    });
});

// API: Чат с моделью
app.post('/api/chat', async (req, res) => {
    try {
        const { model, messages, image } = req.body;

        if (!process.env.OPENROUTER_API_KEY) {
            return res.status(500).json({ error: 'OpenRouter API key not found in .env' });
        }

        // Проверяем модель
        const selectedModel = MODELS.find(m => m.id === model);
        if (!selectedModel) {
            return res.status(400).json({ error: 'Invalid model ID' });
        }

        console.log('📨 Запрос:', selectedModel.name, selectedModel.siteFree ? '(бесплатно)' : '(платно)');

        // Формируем сообщения
        let formattedMessages = messages;

        // Если есть изображение и модель поддерживает vision
        if (image && selectedModel.vision) {
            const lastMessage = formattedMessages[formattedMessages.length - 1];
            formattedMessages[formattedMessages.length - 1] = {
                role: lastMessage.role,
                content: [
                    { type: 'text', text: lastMessage.content },
                    { type: 'image_url', image_url: { url: image } }
                ]
            };
            console.log('🖼️ Добавлено изображение');
        }

        // Запрос к OpenRouter
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'HTTP-Referer': process.env.YOUR_SITE_URL || 'http://localhost:3000',
                'X-Title': process.env.YOUR_SITE_NAME || 'Flux AI',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: model,
                messages: formattedMessages,
                temperature: 0.7,
                max_tokens: 2000
            })
        });

        if (!response.ok) {
            const error = await response.text();
            console.error('❌ OpenRouter error:', error);
            return res.status(response.status).json({ error: 'OpenRouter API error: ' + error });
        }

        const data = await response.json();

        console.log('✅ Ответ получен');

        res.json({
            message: data.choices[0].message.content,
            model: selectedModel.name,
            usage: data.usage
        });

    } catch (error) {
        console.error('❌ Chat error:', error);
        res.status(500).json({ error: 'Internal server error: ' + error.message });
    }
});

// Запуск сервера
app.listen(PORT, () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 FLUX AI SERVER');
    console.log('='.repeat(60));
    console.log('📡 Порт:', PORT);
    console.log('🌐 URL: http://localhost:' + PORT);
    console.log('\n🤖 МОДЕЛИ:');
    console.log('   Всего:', MODELS.length);
    console.log('   🆓 Бесплатных на сайте:', MODELS.filter(m => m.siteFree).length);
    console.log('   💎 За токены:', MODELS.filter(m => !m.siteFree).length);
    console.log('\n🆓 БЕСПЛАТНЫЕ НА САЙТЕ:');
    MODELS.filter(m => m.siteFree).forEach(m => {
        console.log('   •', m.name, m.vision ? '(📷 vision)' : '(📝 text)');
    });
    console.log('\n💎 ЗА ТОКЕНЫ (но :free на OpenRouter):');
    MODELS.filter(m => !m.siteFree).forEach(m => {
        console.log('   •', m.name, m.vision ? '(📷 vision)' : '(📝 text)');
    });
    console.log('\n✅ ВСЕ МОДЕЛИ :free (без Claude и DeepSeek R1)');
    console.log('✅ Возврат токенов при ошибке: включён в клиенте');
    console.log('\n' + '='.repeat(60));
    console.log('✅ Готов к работе!');
    console.log('⚠️  Не забудьте создать .env с OPENROUTER_API_KEY');
    console.log('='.repeat(60) + '\n');
});






























