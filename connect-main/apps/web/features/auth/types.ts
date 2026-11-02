export interface User {
  id: string;
  email: string;
  displayName: string;
}

export interface SignupDTO {
  email: string;
  password: string;
  displayName: string;
}

export interface LoginDTO {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: User;
}

export interface LogoutResponse {
  success: boolean;
}
