/** Shared visual language for the Beparly mobile experience. */
export const appFontFamily = 'BeparlyRobotoRegular';
export const palette = {
  primary: '#00B8A9',
  primaryDeep: '#006D64',
  primaryDark: '#004F49',
  primarySoft: '#E5F8F4',
  background: '#F6F8F7',
  surface: '#FFFFFF',
  border: '#E5ECE9',
  ink: '#15211F',
  secondary: '#52635E',
  muted: '#75847E',
  orange: '#D77843',
  orangeSoft: '#FFF0E6',
  blue: '#3279C8',
  blueSoft: '#EAF3FE',
  purple: '#7559BC',
  purpleSoft: '#F0ECFB',
  rose: '#BD5E86',
  roseSoft: '#FDEEF4',
  amber: '#AE741B',
  amberSoft: '#FFF5E1',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;
export const radius = { sm: 12, md: 16, lg: 20, xl: 24 } as const;
export const typography = {
  eyebrow: 11,
  caption: 12,
  body: 14,
  action: 13,
  section: 18,
  title: 24,
  amount: 36,
} as const;

export const elevation = {
  card: {
    shadowColor: '#153E36',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 2,
  },
  hero: {
    shadowColor: '#003E39',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 5,
  },
} as const;
