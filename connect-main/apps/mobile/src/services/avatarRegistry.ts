/**
 * Tathastu Meet - Controlled Avatar Registry
 * Integrates approved 3D avatars from local asset inventory.
 */
export type AvatarImageSource = any;

export interface BundledAvatar {
  id: string;
  label: string;
  source: AvatarImageSource;
  fullSource: AvatarImageSource;
}


export const BUNDLED_AVATARS: BundledAvatar[] = [
  {
    id: 'avatar_01',
    label: 'Friendly 3D Avatar Portrait',
    source: require('../../assets/avatars/avatar_01_thumb.png'),
    fullSource: require('../../assets/avatars/avatar_01.png'),
  },
  {
    id: 'avatar_02',
    label: 'Cute CGI Avatar with Glasses',
    source: require('../../assets/avatars/avatar_02_thumb.png'),
    fullSource: require('../../assets/avatars/avatar_02.png'),
  },
  {
    id: 'avatar_03',
    label: 'Stylised 3D Avatar Portrait',
    source: require('../../assets/avatars/avatar_03_thumb.png'),
    fullSource: require('../../assets/avatars/avatar_03.png'),
  },
  {
    id: 'avatar_04',
    label: 'Stylised 3D Portrait of a Bearded Man',
    source: require('../../assets/avatars/avatar_04_thumb.png'),
    fullSource: require('../../assets/avatars/avatar_04.png'),
  },
  {
    id: 'avatar_05',
    label: 'Friendly Student Avatar with Headphones',
    source: require('../../assets/avatars/avatar_05_thumb.png'),
    fullSource: require('../../assets/avatars/avatar_05.png'),
  },
  {
    id: 'avatar_06',
    label: 'Charming 3D Avatar Portrait',
    source: require('../../assets/avatars/avatar_06_thumb.png'),
    fullSource: require('../../assets/avatars/avatar_06.png'),
  },
  {
    id: 'avatar_07',
    label: 'Friendly 3D Avatar in Purple Circle',
    source: require('../../assets/avatars/avatar_07_thumb.png'),
    fullSource: require('../../assets/avatars/avatar_07.png'),
  },
  {
    id: 'avatar_08',
    label: 'Stylised 3D Avatar Portrait in Glasses',
    source: require('../../assets/avatars/avatar_08_thumb.png'),
    fullSource: require('../../assets/avatars/avatar_08.png'),
  },
  {
    id: 'avatar_09',
    label: 'Thoughtful Professional Avatar Portrait',
    source: require('../../assets/avatars/avatar_09_thumb.png'),
    fullSource: require('../../assets/avatars/avatar_09.png'),
  },
  {
    id: 'avatar_10',
    label: 'Winking Avatar in Green Hoodie',
    source: require('../../assets/avatars/avatar_10_thumb.png'),
    fullSource: require('../../assets/avatars/avatar_10.png'),
  },
  {
    id: 'avatar_11',
    label: 'Artistic 3D Avatar Portrait',
    source: require('../../assets/avatars/avatar_11_thumb.png'),
    fullSource: require('../../assets/avatars/avatar_11.png'),
  },
];

export function getAvatarSource(avatarId?: string | null): AvatarImageSource | null {
  if (!avatarId) return null;
  const found = BUNDLED_AVATARS.find((a) => a.id === avatarId);
  return found ? found.source : null;
}

export function getAvatarFullSource(avatarId?: string | null): AvatarImageSource | null {
  if (!avatarId) return null;
  const found = BUNDLED_AVATARS.find((a) => a.id === avatarId);
  return found ? found.fullSource : null;
}

/**
 * Deterministically maps any participant identifier (name, identity, email)
 * to one of the 11 premium bundled 3D cartoon avatars.
 */
export function getDeterministicAvatarId(seed?: string | null): string {
  if (!seed || seed.trim() === '') return 'avatar_01';
  let hash = 0;
  const str = seed.trim().toLowerCase();
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % BUNDLED_AVATARS.length;
  return BUNDLED_AVATARS[index].id;
}

