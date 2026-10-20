import { useEffect, type ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

export function Entrance({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = reducedMotion ? 1 : withDelay(delay, withTiming(1, { duration: 300 }));
  }, [delay, progress, reducedMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 10 }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

export function PressScale({ children, style, onPress, ...props }: PressableProps & { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      {...props}
      onPress={onPress}
      onPressIn={(event) => {
        if (!reducedMotion) scale.value = withTiming(0.97, { duration: 110 });
        props.onPressIn?.(event);
      }}
      onPressOut={(event) => {
        if (!reducedMotion) scale.value = withTiming(1, { duration: 150 });
        props.onPressOut?.(event);
      }}
      style={style}>
      <Animated.View style={animatedStyle}>{children}</Animated.View>
    </Pressable>
  );
}
