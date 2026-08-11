const express = require('express');
const app = express();

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});

app.get('/manifest.json', (req, res) => {
    res.json({
        id: 'com.nguonc.stremio.addon',
        version: '1.0.1',
        name: 'NguonC Phim',
        description: 'Tự động tìm Vietsub/Thuyết minh từ NguonC',
        resources: ['stream'],
        types: ['movie', 'series'],
        idPrefixes: ['tt']
    });
});

app.get('/stream/:type/:id.json', async (req, res) => {
    try {
        const { type, id } = req.params;
        const cleanId = id.replace('.json', '');
        
        const parts = cleanId.split(':');
        const imdbId = parts[0];
        const episode = parts[2] ? parseInt(parts[2]) : (parts[1] ? parseInt(parts[1]) : 1);

        // 1. Lấy thông tin phim từ Cinemeta của Stremio
        const cinemetaRes = await fetch(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`);
        const cinemetaData = await cinemetaRes.json();
        
        if (!cinemetaData || !cinemetaData.meta || !cinemetaData.meta.name) {
            return res.json({ streams: [] });
        }

        const rawName = cinemetaData.meta.name;
        // Làm sạch tên phim: Bỏ dấu hai chấm, gạch ngang và khoảng trắng thừa
        const cleanName = rawName.replace(/[:\-]/g, ' ').replace(/\s+/g, ' ').trim();

        // 2. Tìm kiếm trên NguonC
        let searchRes = await fetch(`https://phim.nguonc.com/api/films/search?keyword=${encodeURIComponent(cleanName)}`);
        let searchData = await searchRes.json();

        // Nếu tìm bằng tên đã làm sạch không ra, thử tìm bằng tên gốc ban đầu
        if (!searchData || searchData.status !== 'success' || !searchData.items || searchData.items.length === 0) {
            searchRes = await fetch(`https://phim.nguonc.com/api/films/search?keyword=${encodeURIComponent(rawName)}`);
            searchData = await searchRes.json();
        }

        if (!searchData || searchData.status !== 'success' || !searchData.items || searchData.items.length === 0) {
            return res.json({ streams: [] });
        }

        // Lấy phim đầu tiên tìm được
        const targetSlug = searchData.items[0].slug;

        // 3. Lấy thông tin chi tiết phim & tập phim
        const filmRes = await fetch(`https://phim.nguonc.com/api/film/${targetSlug}`);
        const filmData = await filmRes.json();

        if (!filmData || filmData.status !== 'success' || !filmData.movie) {
            return res.json({ streams: [] });
        }

        const streams = [];
        const episodes = filmData.movie.episodes || [];
        const epIndex = type === 'movie' ? 1 : episode;

        episodes.forEach(server => {
            if (!server.items || server.items.length === 0) return;
            
            // Tìm tập khớp với số tập yêu cầu (bỏ các chữ không phải số)
            let item = server.items.find(ep => {
                const num = parseInt(ep.name.replace(/\D/g, ''));
                return num === epIndex;
            });

            // Nếu không tìm thấy theo số, lấy theo vị trí danh sách
            if (!item) {
                item = server.items[epIndex - 1] || server.items[0];
            }

            if (item && item.m3u8) {
                streams.push({
                    name: `NguonC [${server.server_name}]`,
                    title: `${filmData.movie.name} - ${item.name}`,
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
