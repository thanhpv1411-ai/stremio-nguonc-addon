const express = require('express');
const app = express();

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});

// 1. Manifest khai báo nhận ID dạng IMDb (tt...)
app.get('/manifest.json', (req, res) => {
    res.json({
        id: 'com.nguonc.stremio.addon',
        version: '1.0.0',
        name: 'NguonC Phim',
        description: 'Tự động tìm Vietsub/Thuyết minh từ NguonC',
        resources: ['stream'],
        types: ['movie', 'series'],
        idPrefixes: ['tt']
    });
});

// 2. Xử lý yêu cầu lấy luồng phát từ Stremio (Mã tt...)
app.get('/stream/:type/:id.json', async (req, res) => {
    try {
        const { type, id } = req.params;
        const cleanId = id.replace('.json', '');
        
        // Tách IMDb ID và số tập (Ví dụ phim bộ: tt1234567:1:2 -> IMDb: tt1234567, Tập: 2)
        const parts = cleanId.split(':');
        const imdbId = parts[0];
        const episode = parts[2] ? parseInt(parts[2]) : (parts[1] ? parseInt(parts[1]) : 1);

        // Lấy tên phim từ Cinemeta của Stremio qua IMDb ID
        const cinemetaRes = await fetch(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`);
        const cinemetaData = await cinemetaRes.json();
        
        if (!cinemetaData || !cinemetaData.meta || !cinemetaData.meta.name) {
            return res.json({ streams: [] });
        }

        const movieName = cinemetaData.meta.name;

        // Tìm phim trên NguonC bằng tên phim
        const searchRes = await fetch(`https://phim.nguonc.com/api/films/search?keyword=${encodeURIComponent(movieName)}`);
        const searchData = await searchRes.json();

        if (!searchData || searchData.status !== 'success' || !searchData.items || searchData.items.length === 0) {
            return res.json({ streams: [] });
        }

        // Lấy kết quả đầu tiên khớp nhất
        const targetSlug = searchData.items[0].slug;

        // Lấy danh sách tập phim từ NguonC
        const filmRes = await fetch(`https://phim.nguonc.com/api/film/${targetSlug}`);
        const filmData = await filmRes.json();

        if (!filmData || filmData.status !== 'success' || !filmData.movie) {
            return res.json({ streams: [] });
        }

        const streams = [];
        const episodes = filmData.movie.episodes || [];
        const epIndex = type === 'movie' ? 1 : episode;

        // Trích xuất link m3u8
        episodes.forEach(server => {
            const item = server.items.find(ep => parseInt(ep.name) === epIndex) || server.items[epIndex - 1];
            if (item && item.m3u8) {
                streams.push({
                    name: `NguonC [${server.server_name}]`,
                    title: `${filmData.movie.name} - Tập ${item.name}`,
                    url: item.m3u8
                });
            }
        });

        res.json({ streams });
    } catch (err) {
        res.json({ streams: [] });
    }
});

module.exports = app;
