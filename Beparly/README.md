# Beparly mobile app

Expo SDK 58 app with Tamagui. The first feature is owner registration, phone/password sign-in, owner-only employee creation, and sign-out.

## Local preview

1. Start the Django API from `../beparlyBackend` on port 8000.
2. Run `npx expo start --web` here. If port 8081 is occupied, use `npx expo start --web --port 19006`; the Django development CORS settings allow both ports.
3. Copy `.env.example` to `.env.local` and set `EXPO_PUBLIC_API_URL` to your API URL. For Android, use your computer's LAN URL, such as `http://192.168.1.10:8000`, and add that IP to Django's `DJANGO_ALLOWED_HOSTS`.

The app reads its API URL only from `EXPO_PUBLIC_API_URL`. For the Android emulator, set it to `http://10.0.2.2:8000`. Production builds require an HTTPS API URL.

Products are at Stock → Products and the Home Products action. Android offline catalog creates/edits use SQLite (`beparly-products.db`) and keep selected photos in the app-owned `product-images` document folder until product metadata and the image upload are confirmed. The list labels pending operations. Stock changes require the online API; they are never shown as server-confirmed while offline. Expo Web supports online catalog flows.

Run `pnpm test:products`, `npx tsc --noEmit`, and `npx expo lint`. Use `npx expo start --web` for web preview and `npx expo start` with Expo Go or a development build for Android. Set `EXPO_PUBLIC_API_URL` to the host's LAN address for a real phone, or `http://10.0.2.2:8000` for an Android emulator. Test local image persistence, camera, SQLite recovery, keyboard and Bangla text on Android; web storage behavior does not validate those native paths.

Phone number verification and password recovery are not yet included.
