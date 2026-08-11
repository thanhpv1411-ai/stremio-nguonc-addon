const express = require('express');
const app = express();

// Cấu hình CORS để Stremio kết nối được tới server
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});

// 1. Trả về cấu hình Addon (Manifest)
app.get('/manifest.json', (req, res) => {
    res.json({
        id: 'com.nguonc.stremio.addon',
        version: '1.0.0',
        name: 'NguonC Phim',
        description: 'Xem phim Vietsub/Thuyết minh từ NguonC',
        resources: ['stream'],
        types: ['movie', 'series'],
        idPrefixes: ['nguonc_']
    });
});

// 2. Xử lý yêu cầu lấy nguồn phát phim từ API NguonC
app.get('/stream/:type/:id.json', async (req, res) => {
    const { id } = req.params;
    // Cấu trúc ID truyền từ Stremio: nguonc_<slug-phim>_<tap>
    // Ví dụ: nguonc_hoa-thien-cot_1
    const cleanId = id.replace('.json', '');
    const parts = cleanId.split('_');
    const slug = parts[1];
    const epIndex = parts[2] ? parseInt(parts[2]) : 1;

    if (!slug) {
        return res.json({ streams: [] });
    }

    try {
        // Gọi API NguonC theo slug
        const apiRes = await fetch(`https://phim.nguonc.com/api/film/${slug}`);
        const data = await apiRes.json();

        if (data.status !== 'success' || !data.movie) {
            return res.json({ streams: [] });
        }

        const streams = [];
        const episodes = data.movie.episodes || [];

        // Duyệt danh sách tập phim để lấy link m3u8
        episodes.forEach(server => {
            const item = server.items[epIndex - 1];
            if (item && item.m3u8) {
                streams.push({
                    name: `NguonC [${server.server_name}]`,
                    title: `${data.movie.name} - ${item.name}`,
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
