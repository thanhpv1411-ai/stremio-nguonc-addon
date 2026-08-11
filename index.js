const { addonBuilder } = require('stremio-addon-sdk');
const axios = require('axios');
const express = require('express');
const cors = require('cors');

// Cập nhật manifest để lắng nghe stream từ kho phim gốc của Stremio
const manifest = {
    id: 'org.stremio.nguonc.aiostyle',
    version: '2.0.0',
    name: 'NguonC Stream',
    description: 'Tự động bắt link phim NguonC cho các tìm kiếm chung trên Stremio.',
    resources: ['stream'], // Chỉ cần khai báo stream, Stremio sẽ lo phần danh mục và tìm kiếm
    types: ['movie', 'series'],
    idPrefixes: ['tt', 'tmdb'] // Nhận diện các mã phim từ IMDb (tt...) và TMDB
};

const builder = new addonBuilder(manifest);
const NGUONC_API_BASE = 'https://phim.nguonc.com/api/films';

// Hàm phụ: Dịch mã IMDb thành tên phim thông qua API Cinemeta của Stremio
async function getCinemetaInfo(type, imdbId) {
    try {
        const url = `https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`;
        const res = await axios.get(url);
        return res.data.meta || null;
    } catch (err) {
        console.error(`Lỗi khi lấy thông tin Cinemeta cho ${imdbId}:`, err.message);
        return null;
    }
}

// Hàm xử lý chính: Khi người dùng click vào phim để xem
builder.defineStreamHandler(async ({ type, id }) => {
    // id từ Stremio có dạng "tt1234567" (movie) hoặc "tt1234567:1:2" (series: mùa 1, tập 2)
    const idParts = id.split(':');
    const imdbId = idParts[0]; 
    const season = idParts[1] ? parseInt(idParts[1]) : null;
    const episode = idParts[2] ? parseInt(idParts[2]) : null;

    try {
        // 1. Dịch ID thành tên phim gốc
        const meta = await getCinemetaInfo(type, imdbId);
        if (!meta || !meta.name) return { streams: [] };

        const movieName = meta.name;
        
        // 2. Tự động Search tên phim trên NguonC
        const searchUrl = `${NGUONC_API_BASE}/search?keyword=${encodeURIComponent(movieName)}`;
        const searchRes = await axios.get(searchUrl);
        
        if (!searchRes.data || !searchRes.data.items || searchRes.data.items.length === 0) {
            return { streams: [] }; // NguonC không có phim này
        }

        // Chọn kết quả đầu tiên trả về từ hệ thống
        const filmSlug = searchRes.data.items[0].slug;

        // 3. Gọi API chi tiết của NguonC để lấy link stream
        const detailUrl = `${NGUONC_API_BASE}/phim/${filmSlug}`;
        const detailRes = await axios.get(detailUrl);
        const filmDetail = detailRes.data.item;

        if (!filmDetail || !filmDetail.episodes || filmDetail.episodes.length === 0) {
            return { streams: [] };
        }

        let streamUrl = null;

        // 4. Bóc tách link xem phim dựa theo loại hình (Movie / Series)
        if (type === 'movie') {
            streamUrl = filmDetail.episodes[0].server_data[0].link_m3u8;
        } else if (type === 'series' && episode) {
            // Đối với Series, tìm đúng tập tin tương ứng
            const serverData = filmDetail.episodes[0].server_data;
            const epData = serverData.find(
                ep => ep.name == episode || ep.slug.includes(`tap-${episode}`)
            );
            
            if (epData) {
                streamUrl = epData.link_m3u8;
            } else if (serverData[episode - 1]) {
                // Dự phòng: Lấy theo thứ tự tập nếu không khớp tên
                streamUrl = serverData[episode - 1].link_m3u8;
            }
        }

        if (streamUrl) {
            return {
                streams: [
                    {
                        title: 'NguonC\n[Phát bằng HLS]',
                        url: streamUrl,
                        behaviorHints: { notWebReady: false }
                    }
                ]
            };
        }
    } catch (err) {
        console.error("Lỗi nội bộ khi bắt stream:", err.message);
    }

    // Nếu có bất kỳ lỗi nào hoặc không tìm thấy phim, trả về rỗng
    return { streams: [] };
});

const app = express();
app.use(cors());

// Tích hợp Addon vào Express
const addonInterface = builder.getInterface();
const { getRouter } = require('stremio-addon-sdk');
app.use('/', getRouter(addonInterface));

const port = process.env.PORT || 7000;
app.listen(port, () => {
    console.log(`NguonC Addon (AIO style) đang chạy tại port ${port}`);
});

module.exports = app;
