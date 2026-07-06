// Synthetic HackerRank contest dashboard, used when MOCK=1 so the whole pipeline
// (admin login → roster → scrape → dashboard) works without internet.
export function buildMockDashboard(slug, max = 60) {
  const questions = [
    { name: 'Array Rotation', url: '#', points: 30 },
    { name: 'Binary Search Tree', url: '#', points: 50 },
    { name: 'Dynamic Programming Path', url: '#', points: 70 },
    { name: 'Graph Shortest Path', url: '#', points: 80 },
    { name: 'String Compression', url: '#', points: 40 },
  ];
  const n = Math.min(max, 60);
  const names = ['aarav', 'diya', 'rohan', 'isha', 'kabir', 'ananya', 'vihaan', 'sara', 'arjun', 'mira', 'dev', 'tara', 'neil', 'zoya', 'omkar'];
  const users = [];
  for (let i = 0; i < n; i++) {
    const username = `${names[i % names.length]}_${i}`;
    const skill = 1 - i / n;
    const questionStatus = {}; let solved = 0, attempted = 0, score = 0;
    for (const q of questions) {
      const attempt = Math.random() < 0.4 + skill * 0.5;
      const solve = attempt && Math.random() < skill * 0.9 + 0.05;
      const s = solve ? q.points : (attempt ? Math.round(q.points * Math.random() * 0.5) : 0);
      questionStatus[q.name] = { score: s, points: q.points, attempted: attempt, solved: solve };
      if (solve) solved++; if (attempt) attempted++; score += s;
    }
    users.push({ username, rank: i + 1, computedScore: score, solved, attempted, questionStatus });
  }
  users.sort((a, b) => b.computedScore - a.computedScore).forEach((u, i) => (u.rank = i + 1));
  const totalSolves = users.reduce((a, u) => a + u.solved, 0);
  return {
    contest: { slug, name: `Mock Contest (${slug})`, challengesCount: questions.length },
    summary: { totalUsers: users.length, totalQuestions: questions.length, avgSolved: +(totalSolves / users.length).toFixed(2), overallCompletion: Math.round((totalSolves / (users.length * questions.length)) * 100) },
    questions, users, reference: users[0].username, warnings: 'MOCK MODE — synthetic data.',
  };
}
