import { apiFetch } from '@/lib/api/client';

export interface AppNotification {
  id: string;
  seq: number;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

export const listNotifications = (before?: number) =>
  apiFetch<{ notifications: AppNotification[]; unread: number }>(
    `/api/v1/notifications?limit=30${before ? `&before=${before}` : ''}`,
    { method: 'GET' }
  );

export const markNotificationRead = (id: string) =>
  apiFetch(`/api/v1/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });

export const markAllNotificationsRead = () => apiFetch('/api/v1/notifications/read-all', { method: 'POST' });
