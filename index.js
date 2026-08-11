const { addonBuilder } = require('stremio-addon-sdk');
const axios = require('axios');
const express = require('express');
const cors = require('cors');

// Cập nhật lên bản 2.0.1, chỉ xử lý Stream
const manifest = {
    id: 'org.stremio.nguonc.aiostyle',
    version: '2.0.1', 
    name: 'NguonC Stream AIO',
    description: 'Tự động bắt link phim NguonC cho Stremio.',
    resources: ['stream'], 
    types: ['movie', 'series'],
    idPrefixes: ['tt', 'tmdb']
};

const builder = new addonBuilder(manifest);
const NGUONC_API_BASE = 'https://phim.nguonc.com/api/films';

// Dịch mã IMDb thành tên phim
async function getCinemetaInfo(type, imdbId) {
    try {
        const url = `https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`;
        const res = await axios.get(url);
        return res.data.meta || null;
    } catch (err) {
        return null;
    }
}

// Xử lý tự động tìm và bóc link phim
builder.defineStreamHandler(async ({ type, id }) => {
    const idParts = id.split(':');
    const imdbId = idParts[0];
    const episode = idParts[2] ? parseInt(idParts[2]) : null;

    try {
        const meta = await getCinemetaInfo(type, imdbId);
        if (!meta || !meta.name) return { streams: [] };

        const movieName = meta.name;
        
        // Tìm kiếm phim trên hệ thống NguonC
        const searchRes = await axios.get(`${NGUONC_API_BASE}/search?keyword=${encodeURIComponent(movieName)}`);
        
        if (!searchRes.data || !searchRes.data.items || searchRes.data.items.length === 0) {
            return { streams: [] }; 
        }

        const filmSlug = searchRes.data.items[0].slug;
        const detailRes = await axios.get(`${NGUONC_API_BASE}/phim/${filmSlug}`);
        const filmDetail = detailRes.data.item;

        if (!filmDetail || !filmDetail.episodes || filmDetail.episodes.length === 0) return { streams: [] };

        let streamUrl = null;

        if (type === 'movie') {
            streamUrl = filmDetail.episodes[0].server_data[0].link_m3u8;
        } else if (type === 'series' && episode) {
            const serverData = filmDetail.episodes[0].server_data;
            const epData = serverData.find(ep => ep.name == episode || ep.slug.includes(`tap-${episode}`));
            
            if (epData) streamUrl = epData.link_m3u8;
            else if (serverData[episode - 1]) streamUrl = serverData[episode - 1].link_m3u8;
        }

        if (streamUrl) {
            return {
                streams: [{
                    title: 'NguonC\n[HLS Stream]',
                    url: streamUrl,
                    behaviorHints: { notWebReady: false }
                }]
            };
        }
    } catch (err) {
        console.error("Lỗi khi tìm stream:", err.message);
    }

    return { streams: [] };
});

const app = express();
app.use(cors());

const addonInterface = builder.getInterface();
const { getRouter } = require('stremio-addon-sdk');
app.use('/', getRouter(addonInterface));

// SỬA LỖI VERCEL: Chỉ chạy cổng localhost khi test cục bộ, không chạy trên Vercel
if (process.env.NODE_ENV !== 'production') {
    const port = process.env.PORT || 7000;
    app.listen(port, () => {
        console.log(`Test cục bộ đang chạy tại http://localhost:${port}`);
    });
}

// Bắt buộc phải export app để Vercel serverless function hoạt động
module.exports = app;
