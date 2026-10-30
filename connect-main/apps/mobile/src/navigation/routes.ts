/**
 * Tathastu Connect Native Screen Route Hierarchy
 */

export type RootStackParamList = {
  Welcome: undefined;
  SignIn: { redirectRoute?: string };
  SignUp: undefined;
  HomeScreen: undefined;
  JoinRoom: { initialCode?: string };
  PreJoinPreview: { roomCode: string };
  LiveMeetingStage: { roomCode: string; token: string; isHost: boolean };
  ParticipantGallery: { roomCode: string };
  MeetingHistory: undefined;
  Settings: undefined;
};

export const NATIVE_DEEP_LINK_PREFIXES = [
  'tathastu://',
  'https://connect.aitathastu.com',
];

export const DEEP_LINK_CONFIG = {
  prefixes: NATIVE_DEEP_LINK_PREFIXES,
  config: {
    screens: {
      HomeScreen: '',
      SignIn: 'sign-in',
      SignUp: 'sign-up',
      MeetingHistory: 'history',
      PreJoinPreview: 'room/:roomCode/preview',
      LiveMeetingStage: 'room/:roomCode',
    },
  },
};
