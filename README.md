# Booth LDR

Photobooth live untuk pasangan jarak jauh. Background kamar dihapus, lalu kalian berdua digabung dalam satu frame dengan latar sesuai frame yang dipilih.

## Deploy ke GitHub Pages
1. Upload `index.html`, `style.css`, `app.js` ke root repo.
2. Settings → Pages → Deploy from a branch → `main` / `(root)` → Save.

## Model penghapus background (opsional)
Model diunduh otomatis dari Google. Kalau di jaringanmu gagal, simpan salinannya di repo:

1. Unduh: https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite
2. Taruh di repo sebagai `models/selfie_segmenter.tflite`.

Situs otomatis memakai salinan ini kalau unduhan dari Google gagal.
