import { defaultConfig } from '@tamagui/config/v6';
import { createTamagui } from 'tamagui';
import { appFontFamily, palette, radius, spacing } from './src/constants/design-system';
import { animations } from './tamagui.animations';

export const tamaguiConfig = createTamagui({
  ...defaultConfig,
  animations,
  fonts: {
    ...defaultConfig.fonts,
    body: { ...defaultConfig.fonts.body, family: appFontFamily },
    heading: { ...defaultConfig.fonts.heading, family: appFontFamily },
  },
  tokens: {
    ...defaultConfig.tokens,
    color: {
      ...defaultConfig.tokens.color,
      beparlyPrimary: palette.primary,
      beparlyPrimaryDeep: palette.primaryDeep,
      beparlyBackground: palette.background,
      beparlySurface: palette.surface,
      beparlyBorder: palette.border,
      beparlyInk: palette.ink,
    },
    radius: { ...defaultConfig.tokens.radius, beparlySm: radius.sm, beparlyMd: radius.md, beparlyLg: radius.lg },
    space: { ...defaultConfig.tokens.space, beparlySm: spacing.sm, beparlyMd: spacing.md, beparlyLg: spacing.lg, beparlyXl: spacing.xl },
  },
});

export default tamaguiConfig;

export type TamaguiConfig = typeof tamaguiConfig;

declare module 'tamagui' {
  interface TamaguiCustomConfig extends TamaguiConfig {}
}
