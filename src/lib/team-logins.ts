/** What the owner's team-logins screen may see of a stylist login. Never the hash. */
export const LOGIN_FIELDS = {
  id: true,
  email: true,
  name: true,
  stylistName: true,
  diaryScope: true,
  canSeeTakings: true,
  mustChangePassword: true,
  createdAt: true,
} as const;
