// Synthetic dashboard data so the UI + pipeline can be tested without a live
// HackerRank session. Enabled with MOCK=1 (npm run mock).

export function buildMockDashboard(slug, max = 60) {
  const questions = [
    { name: 'Array Rotation', url: '#', points: 30 },
    { name: 'Binary Search Tree', url: '#', points: 50 },
    { name: 'Dynamic Programming Path', url: '#', points: 70 },
    { name: 'Graph Shortest Path', url: '#', points: 80 },
    { name: 'String Compression', url: '#', points: 40 },
  ];
  const n = Math.min(max, 60);
  const firstNames = ['aarav', 'diya', 'rohan', 'isha', 'kabir', 'ananya', 'vihaan', 'sara', 'arjun', 'mira', 'dev', 'tara', 'neil', 'zoya', 'omkar'];

  const users = [];
  for (let i = 0; i < n; i++) {
    const username = `${firstNames[i % firstNames.length]}_${i}`;
    // Higher-ranked users solve more.
    const skill = 1 - i / n;
    const questionStatus = {};
    let solved = 0, attempted = 0, score = 0;
    for (const q of questions) {
      const attempt = Math.random() < 0.4 + skill * 0.5;
      const solve = attempt && Math.random() < skill * 0.9 + 0.05;
      const s = solve ? q.points : (attempt ? Math.round(q.points * Math.random() * 0.5) : 0);
      questionStatus[q.name] = { score: s, points: q.points, attempted: attempt, solved: solve };
      if (solve) solved++;
      if (attempt) attempted++;
      score += s;
    }
    users.push({ username, rank: i + 1, leaderboardScore: score, computedScore: score, solved, attempted, questionStatus });
  }
  users.sort((a, b) => b.computedScore - a.computedScore).forEach((u, i) => (u.rank = i + 1));

  const totalUsers = users.length;
  const qCount = questions.length;
  const perQuestion = questions.map((q) => {
    let solvedCount = 0, attemptedCount = 0;
    for (const u of users) {
      if (u.questionStatus[q.name].solved) solvedCount++;
      if (u.questionStatus[q.name].attempted) attemptedCount++;
    }
    return { name: q.name, url: q.url, points: q.points, solved: solvedCount, attempted: attemptedCount, solveRate: Math.round((solvedCount / totalUsers) * 100) };
  });
  const solvedDistribution = Array.from({ length: qCount + 1 }, () => 0);
  for (const u of users) solvedDistribution[u.solved]++;
  const totalSolves = users.reduce((a, u) => a + u.solved, 0);

  return {
    contest: { slug, name: `Mock Contest (${slug})`, challengesCount: qCount },
    summary: {
      totalUsers,
      totalQuestions: qCount,
      avgSolved: +(totalSolves / totalUsers).toFixed(2),
      fullSolvers: users.filter((u) => u.solved === qCount).length,
      zeroSolvers: users.filter((u) => u.solved === 0).length,
      overallCompletion: Math.round((totalSolves / (totalUsers * qCount)) * 100),
    },
    questions,
    users,
    aggregates: { perQuestion, solvedDistribution },
    reference: users[0].username,
    warnings: 'MOCK MODE — this is synthetic data.',
  };
}
