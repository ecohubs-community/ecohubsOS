export function getLevel(xp: number): number {
  return Math.floor(0.1 * Math.sqrt(xp));
}

export function xpForNextLevel(currentXp: number): number {
  const currentLevel = getLevel(currentXp);
  const nextLevelXp = 100 * (currentLevel + 1) ** 2;
  return Math.max(0, nextLevelXp - currentXp);
}
