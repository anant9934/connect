/**
 * iOS AVFoundation Permission Specifications for Tathastu Connect
 * Targets iOS 15.0+ Privacy & Usage Descriptions.
 */

export interface IOSInfoPlistRequirements {
  NSCameraUsageDescription: string;
  NSMicrophoneUsageDescription: string;
  NSBluetoothAlwaysUsageDescription: string;
}

export const IOS_PERMISSIONS_CONFIG: IOSInfoPlistRequirements = {
  NSCameraUsageDescription:
    'Tathastu Connect needs camera access to broadcast your video to participants in the room.',
  NSMicrophoneUsageDescription:
    'Tathastu Connect needs microphone access to transmit clear audio during collaborative meetings.',
  NSBluetoothAlwaysUsageDescription:
    'Tathastu Connect connects to your wireless headsets and audio peripherals for seamless sound.',
};

export type IOSPermissionStatus = 'authorized' | 'denied' | 'restricted' | 'notDetermined';
