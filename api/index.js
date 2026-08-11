const express = require('express');
const app = express();

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});

// 1. Manifest mới (Đổi ID sang com.nguonc.v2.stremio để ép Stremio xóa cache cũ)
app.get('/manifest.json', (req, res) => {
    res.json({
        id: 'com.nguonc.v2.stremio',
        version: '2.0.0',
        name: 'NguonC Phim Vietsub',
        description: 'Xem phim Vietsub/Thuyết minh từ NguonC',
        resources: ['catalog', 'stream'],
        types: ['movie', 'series'],
        idPrefixes: ['tt', 'nguonc:'],
        catalogs: [
            {
                type: 'movie',
                id: 'nguonc_catalog',
                name: 'NguonC Tìm Phim',
                extra: [{ name: 'search', isRequired: false }]
            }
        ]
    });
});

// 2. Xử lý Tìm kiếm trực tiếp trên Stremio (Hiện thẻ phim NguonC)
app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
    try {
        const extraStr = req.params.extra || '';
        let query = '';
        if (extraStr.startsWith('search=')) {
            query = decodeURIComponent(extraStr.replace('search=', '').replace('.json', ''));
        }

        if (!query) {
            const apiRes = await fetch('https://phim.nguonc.com/api/films/phim-moi-cap-nhat?page=1');
            const data = await apiRes.json();
            const metas = (data.items || []).map(item => ({
                id: `nguonc:${item.slug}`,
                type: 'movie',
                name: item.name,
                poster: item.thumb_url || item.poster_url,
                description: item.original_name || ''
            }));
            return res.json({ metas });
        }

        const searchRes = await fetch(`https://phim.nguonc.com/api/films/search?keyword=${encodeURIComponent(query)}`);
        const searchData = await searchRes.json();
        
        const metas = (searchData.items || []).map(item => ({
            id: `nguonc:${item.slug}`,
            type: 'movie',
            name: item.name,
            poster: item.thumb_url || item.poster_url,
            description: item.original_name || ''
        }));

        res.json({ metas });
    } catch (err) {
        res.json({ metas: [] });
    }
});

// 3. Xử lý Lấy Nguồn phát Stream
app.get('/stream/:type/:id.json', async (req, res) => {
    try {
        const { type, id } = req.params;
        const cleanId = id.replace('.json', '');
        
        let targetSlug = '';
        let episode = 1;

        if (cleanId.startsWith('nguonc:')) {
            // Khi chọn trực tiếp thẻ phim NguonC
            const parts = cleanId.replace('nguonc:', '').split(':');
            targetSlug = parts[0];
            episode = parts[2] ? parseInt(parts[2]) : (parts[1] ? parseInt(parts[1]) : 1);
        } else if (cleanId.startsWith('tt')) {
            // Khi chọn phim IMDb từ Cinemeta
            const parts = cleanId.split(':');
            const imdbId = parts[0];
            episode = parts[2] ? parseInt(parts[2]) : (parts[1] ? parseInt(parts[1]) : 1);

            const cinemetaRes = await fetch(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`);
            const cinemetaData = await cinemetaRes.json();
            
            if (cinemetaData && cinemetaData.meta && cinemetaData.meta.name) {
                const rawName = cinemetaData.meta.name;
                const cleanName = rawName.replace(/[:\-]/g, ' ').replace(/\s+/g, ' ').trim();

                let searchRes = await fetch(`https://phim.nguonc.com/api/films/search?keyword=${encodeURIComponent(cleanName)}`);
                let searchData = await searchRes.json();

                if (!searchData || searchData.status !== 'success' || !searchData.items || searchData.items.length === 0) {
                    searchRes = await fetch(`https://phim.nguonc.com/api/films/search?keyword=${encodeURIComponent(rawName)}`);
                    searchData = await searchRes.json();
                }

                if (searchData && searchData.status === 'success' && searchData.items && searchData.items.length > 0) {
                    targetSlug = searchData.items[0].slug;
                }
            }
        }

        if (!targetSlug) {
            return res.json({ streams: [] });
        }

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
            
            let item = server.items.find(ep => {
                const num = parseInt(ep.name.replace(/\D/g, ''));
                return num === epIndex;
            });

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
