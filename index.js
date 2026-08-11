const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');
const express = require('express');
const cors = require('cors');

// 1. Khai báo thông tin Add-on hiển thị trên Stremio
const manifest = {
    id: 'org.stremio.nguonc',
    version: '1.0.0',
    name: 'NguonC Phim',
    description: 'Xem phim từ hệ thống nguonc.com',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series'],
    catalogs: [
        { type: 'movie', id: 'nguonc_movies', name: 'NguonC Phim Mới' }
    ],
    idPrefixes: ['nguonc_'] // Tiền tố để Stremio nhận diện phim của add-on này
};

const builder = new addonBuilder(manifest);

const NGUONC_API_BASE = 'https://phim.nguonc.com/api/films'; // Lưu ý: Cần điều chỉnh API thực tế của trang

// 2. Trả về danh sách phim (Catalog)
builder.defineCatalogHandler(async ({ type, id }) => {
    if (type === 'movie' && id === 'nguonc_movies') {
        try {
            // Gọi API của NguonC để lấy danh sách phim mới
            const response = await axios.get(`${NGUONC_API_BASE}/phim-moi-cap-nhat`);
            const films = response.data.items; 
            
            const metas = films.map(film => ({
                id: `nguonc_${film.slug}`,
                type: 'movie',
                name: film.name,
                poster: film.thumb_url
            }));
            
            return { metas };
        } catch (error) {
            console.error(error);
            return { metas: [] };
        }
    }
    return { metas: [] };
});

// 3. Trả về thông tin chi tiết phim (Meta)
builder.defineMetaHandler(async ({ type, id }) => {
    if (id.startsWith('nguonc_')) {
        const slug = id.replace('nguonc_', '');
        try {
            const response = await axios.get(`${NGUONC_API_BASE}/phim/${slug}`);
            const film = response.data.item;

            return {
                meta: {
                    id: id,
                    type: type,
                    name: film.name,
                    description: film.content,
                    poster: film.thumb_url,
                    background: film.poster_url
                }
            };
        } catch (error) {
            console.error(error);
            return { meta: {} };
        }
    }
    return Promise.resolve({ meta: {} });
});

// 4. Trả về link phát video (Stream)
builder.defineStreamHandler(async ({ type, id }) => {
    if (id.startsWith('nguonc_')) {
        const slug = id.replace('nguonc_', '');
        try {
            const response = await axios.get(`${NGUONC_API_BASE}/phim/${slug}`);
            const film = response.data.item;
            
            // Giả định API trả về m3u8 trong mảng episodes
            const m3u8Link = film.episodes[0].server_data[0].link_m3u8; 

            return {
                streams: [
                    {
                        title: 'NguonC Stream (HLS)',
                        url: m3u8Link
                    }
                ]
            };
        } catch (error) {
            console.error(error);
            return { streams: [] };
        }
    }
    return Promise.resolve({ streams: [] });
});

// Khởi tạo Server cho Vercel
const app = express();
app.use(cors());

// Chuyển Addon interface vào Express router
const addonInterface = builder.getInterface();
const { getRouter } = require('stremio-addon-sdk');
app.use('/', getRouter(addonInterface));

const port = process.env.PORT || 7000;
app.listen(port, () => {
    console.log(`Addon đang chạy tại http://localhost:${port}`);
});

module.exports = app;
