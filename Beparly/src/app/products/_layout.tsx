import { Stack } from 'expo-router';
import { blurWebFocus } from '@/utils/web-focus';
export default function ProductLayout() { return <Stack screenOptions={{ headerShown: false }} screenListeners={{ transitionStart: blurWebFocus, blur: blurWebFocus }} />; }
