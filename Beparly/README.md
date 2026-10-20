# Beparly mobile app

Expo SDK 58 app with Tamagui. The first feature is owner registration, phone/password sign-in, owner-only employee creation, and sign-out.

## Local preview

1. Start the Django API from `../beparlyBackend` on port 8000.
2. Run `npx expo start --web` here. If port 8081 is occupied, use `npx expo start --web --port 19006`; the Django development CORS settings allow both ports.
3. Copy `.env.example` to `.env.local` and set `EXPO_PUBLIC_API_URL` to your API URL. For Android, use your computer's LAN URL, such as `http://192.168.1.10:8000`, and add that IP to Django's `DJANGO_ALLOWED_HOSTS`.

The app reads its API URL only from `EXPO_PUBLIC_API_URL`. For the Android emulator, set it to `http://10.0.2.2:8000`. Production builds require an HTTPS API URL.

Authentication tokens currently stay in memory, so users sign in again after an app restart. This avoids storing them in plaintext while secure device storage is not installed. Phone number verification and password recovery are not yet included.
