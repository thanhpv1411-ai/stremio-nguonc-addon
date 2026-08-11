const express = require('express');
const app = express();

// Giả lập User-Agent trình duyệt để API NguonC không chặn request từ Vercel
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json'
};

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});

// 1. Manifest (Đổi ID sang com.nguonc.v3.stremio để xóa triệt để cache cũ trên Stremio)
app.get('/manifest.json', (req, res) => {
    res.json({
        id: 'com.nguonc.v3.stremio',
        version: '3.0.0',
        name: 'NguonC Phim Vietsub',
        description: 'Xem phim Vietsub/Thuyết minh từ NguonC',
        resources: ['catalog', 'meta', 'stream'],
        types: ['movie', 'series'],
        idPrefixes: ['tt', 'nguonc:'],
        catalogs: [
            {
                type: 'movie',
                id: 'nguonc_movie',
                name: 'NguonC Phim Lẻ',
                extra: [{ name: 'search', isRequired: false }]
            },
            {
                type: 'series',
                id: 'nguonc_series',
                name: 'NguonC Phim Bộ',
                extra: [{ name: 'search', isRequired: false }]
            }
        ]
    });
});

// 2. Catalog (Danh sách phim & Tìm kiếm)
app.get('/catalog/:type/:id*', async (req, res) => {
    try {
        const { type } = req.params;
        const rawPath = req.params[0] || '';
        let query = '';

        if (rawPath.includes('search=')) {
            const match = rawPath.match(/search=([^/.]+)/);
            if (match && match[1]) {
                query = decodeURIComponent(match[1]);
            }
        }

        let url = 'https://phim.nguonc.com/api/films/phim-moi-cap-nhat?page=1';
        if (query) {
            url = `https://phim.nguonc.com/api/films/search?keyword=${encodeURIComponent(query)}`;
        }

        const apiRes = await fetch(url, { headers: HEADERS });
        const data = await apiRes.json();

        const metas = (data.items || []).map(item => ({
            id: `nguonc:${item.slug}`,
            type: type || 'movie',
            name: item.name,
            poster: item.thumb_url || item.poster_url,
            description: `${item.original_name || ''} | ${item.current_episode || ''}`
        }));

        res.json({ metas });
    } catch (err) {
        res.json({ metas: [] });
    }
});

// 3. Meta (Chi tiết phim & Bảng danh sách tập - Yêu cầu bắt buộc của Stremio)
app.get('/meta/:type/:id*', async (req, res) => {
    try {
        const { type } = req.params;
        const fullId = (req.params.id + (req.params[0] || '')).replace('.json', '');
        
        if (!fullId.startsWith('nguonc:')) {
            return res.json({ meta: null });
        }

        const slug = fullId.replace('nguonc:', '').split(':')[0];
        const apiRes = await fetch(`https://phim.nguonc.com/api/film/${slug}`, { headers: HEADERS });
        const data = await apiRes.json();

        if (data.status !== 'success' || !data.movie) {
            return res.json({ meta: null });
        }

        const film = data.movie;
        const episodes = film.episodes || [];

        let videos = [];
        if (episodes.length > 0 && episodes[0].items) {
            videos = episodes[0].items.map((item, idx) => {
                const epNum = parseInt(item.name.replace(/\D/g, '')) || (idx + 1);
                return {
                    id: `nguonc:${slug}:${epNum}`,
                    title: `Tập ${item.name}`,
                    season: 1,
                    episode: epNum
                };
            });
        }

        res.json({
            meta: {
                id: `nguonc:${slug}`,
                type: type,
                name: film.name,
                poster: film.thumb_url || film.poster_url,
                background: film.poster_url || film.thumb_url,
                description: film.description || film.original_name,
                videos: videos.length > 0 ? videos : undefined
            }
        });
    } catch (err) {
        res.json({ meta: null });
    }
});

// 4. Stream (Trích xuất link m3u8 phát trực tiếp)
app.get('/stream/:type/:id*', async (req, res) => {
    try {
        const { type } = req.params;
        const fullId = (req.params.id + (req.params[0] || '')).replace('.json', '');
        
        let targetSlug = '';
        let episode = 1;

        if (fullId.startsWith('nguonc:')) {
            const parts = fullId.replace('nguonc:', '').split(':');
            targetSlug = parts[0];
            episode = parts[1] ? parseInt(parts[1]) : 1;
        } else if (fullId.startsWith('tt')) {
            const parts = fullId.split(':');
            const imdbId = parts[0];
            episode = parts[2] ? parseInt(parts[2]) : (parts[1] ? parseInt(parts[1]) : 1);

            const cinemetaRes = await fetch(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`);
            const cinemetaData = await cinemetaRes.json();

            if (cinemetaData && cinemetaData.meta && cinemetaData.meta.name) {
                const rawName = cinemetaData.meta.name;
                const cleanName = rawName.replace(/[:\-]/g, ' ').replace(/\s+/g, ' ').trim();

                let searchRes = await fetch(`https://phim.nguonc.com/api/films/search?keyword=${encodeURIComponent(cleanName)}`, { headers: HEADERS });
                let searchData = await searchRes.json();

                if (!searchData || !searchData.items || searchData.items.length === 0) {
                    searchRes = await fetch(`https://phim.nguonc.com/api/films/search?keyword=${encodeURIComponent(rawName)}`, { headers: HEADERS });
                    searchData = await searchRes.json();
                }

                if (searchData && searchData.items && searchData.items.length > 0) {
                    targetSlug = searchData.items[0].slug;
                }
            }
        }

        if (!targetSlug) {
            return res.json({ streams: [] });
        }

        const filmRes = await fetch(`https://phim.nguonc.com/api/film/${targetSlug}`, { headers: HEADERS });
        const filmData = await filmRes.json();

        if (filmData.status !== 'success' || !filmData.movie) {
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
