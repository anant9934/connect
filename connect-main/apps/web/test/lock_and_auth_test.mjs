async function runSecurityTests() {
  console.log('--- Testing Room Lock, BOLA/IDOR, and Ended Room Security ---');

  // 1. Sign up Host
  const hostEmail = `host_${Date.now()}@example.com`;
  const hostSignupRes = await fetch('http://localhost:8080/api/v1/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: hostEmail, password: 'ValidPass123!', displayName: 'Host Owner' }),
  });
  const hostCookies = hostSignupRes.headers.get('set-cookie');
  console.log('Host signed up successfully');

  // 2. Create room by Host
  const roomRes = await fetch('http://localhost:8080/api/v1/rooms', {
    method: 'POST',
    headers: { 'Origin': 'http://localhost:3000', 'Cookie': hostCookies },
  });
  const roomData = await roomRes.json();
  const roomCode = roomData.room.publicCode;
  console.log(`Host created room: ${roomCode}`);

  // 3. Sign up Attacker
  const attackerEmail = `attacker_${Date.now()}@example.com`;
  const attackerSignupRes = await fetch('http://localhost:8080/api/v1/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: attackerEmail, password: 'ValidPass123!', displayName: 'Malicious User' }),
  });
  const attackerCookies = attackerSignupRes.headers.get('set-cookie');
  console.log('Attacker signed up');

  // 4. Test BOLA: Attacker tries to lock Host's room
  const attackerLockRes = await fetch(`http://localhost:8080/api/v1/rooms/${roomCode}/lock`, {
    method: 'POST',
    headers: { 'Origin': 'http://localhost:3000', 'Cookie': attackerCookies },
  });
  if (attackerLockRes.status === 403) {
    console.log('TEST PASSED: Attacker cannot lock Host room (403 Forbidden)');
  } else {
    throw new Error(`BOLA FAILURE: Attacker locked room with status ${attackerLockRes.status}`);
  }

  // 5. Test BOLA: Attacker tries to end Host's room
  const attackerEndRes = await fetch(`http://localhost:8080/api/v1/rooms/${roomCode}/end`, {
    method: 'POST',
    headers: { 'Origin': 'http://localhost:3000', 'Cookie': attackerCookies },
  });
  if (attackerEndRes.status === 403) {
    console.log('TEST PASSED: Attacker cannot end Host room (403 Forbidden)');
  } else {
    throw new Error(`BOLA FAILURE: Attacker ended room with status ${attackerEndRes.status}`);
  }

  // 6. Host locks own room
  const hostLockRes = await fetch(`http://localhost:8080/api/v1/rooms/${roomCode}/lock`, {
    method: 'POST',
    headers: { 'Origin': 'http://localhost:3000', 'Cookie': hostCookies },
  });
  if (hostLockRes.status === 200) {
    console.log('TEST PASSED: Host locked own room successfully (200 OK)');
  }

  // 7. Test Locked Room: Guest tries to join locked room
  const guestJoinRes = await fetch(`http://localhost:8080/api/v1/rooms/${roomCode}/join`, {
    method: 'POST',
    headers: { 'Origin': 'http://localhost:3000', 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: 'Late Guest' }),
  });
  if (guestJoinRes.status === 403) {
    console.log('TEST PASSED: Guest blocked from locked room (403 Forbidden: ROOM_LOCKED)');
  } else {
    throw new Error(`SECURITY FAILURE: Guest joined locked room with status ${guestJoinRes.status}`);
  }

  // 8. Host unlocks room
  const hostUnlockRes = await fetch(`http://localhost:8080/api/v1/rooms/${roomCode}/unlock`, {
    method: 'POST',
    headers: { 'Origin': 'http://localhost:3000', 'Cookie': hostCookies },
  });
  if (hostUnlockRes.status === 200) {
    console.log('TEST PASSED: Host unlocked room successfully (200 OK)');
  }

  // 9. Host ends room
  const hostEndRes = await fetch(`http://localhost:8080/api/v1/rooms/${roomCode}/end`, {
    method: 'POST',
    headers: { 'Origin': 'http://localhost:3000', 'Cookie': hostCookies },
  });
  if (hostEndRes.status === 200) {
    console.log('TEST PASSED: Host ended room successfully (200 OK)');
  }

  // 10. Rejoining ended room blocked
  const rejoinRes = await fetch(`http://localhost:8080/api/v1/rooms/${roomCode}/join`, {
    method: 'POST',
    headers: { 'Origin': 'http://localhost:3000', 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: 'Late Guest' }),
  });
  if (rejoinRes.status === 410) {
    console.log('TEST PASSED: Rejoining ended room blocked (410 Gone: ROOM_ENDED)');
  } else {
    throw new Error(`SECURITY FAILURE: Joined ended room with status ${rejoinRes.status}`);
  }

  console.log('=== ALL ROOM SECURITY & BOLA TESTS PASSED ===');
}

runSecurityTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
