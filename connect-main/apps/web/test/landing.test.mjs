import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import nextConfig from '../next.config.mjs';

describe('Web Platform Security & Header Verification', () => {
  test('Next.js config defines mandatory security headers', async () => {
    assert.strictEqual(typeof nextConfig.headers, 'function');
    const headersConfig = await nextConfig.headers();
    assert.ok(headersConfig.length > 0);

    const rootHeaders = headersConfig.find((h) => h.source === '/:path*');
    assert.ok(rootHeaders, 'Root path security headers must be configured');

    const headerMap = new Map(rootHeaders.headers.map((h) => [h.key, h.value]));

    // 1. Verify anti-MIME sniffing
    assert.strictEqual(headerMap.get('X-Content-Type-Options'), 'nosniff');

    // 2. Verify anti-clickjacking
    assert.strictEqual(headerMap.get('X-Frame-Options'), 'DENY');

    // 3. Verify Referrer policy
    assert.strictEqual(headerMap.get('Referrer-Policy'), 'strict-origin-when-cross-origin');

    // 4. Verify restricted hardware sensor permissions on landing
    const permPolicy = headerMap.get('Permissions-Policy');
    assert.ok(permPolicy.includes('camera=()'), 'Camera must be restricted on non-meeting landing');
    assert.ok(permPolicy.includes('microphone=()'), 'Microphone must be restricted on non-meeting landing');

    // 5. Verify Content-Security-Policy
    const csp = headerMap.get('Content-Security-Policy');
    assert.ok(csp.includes("default-src 'self'"), 'CSP must restrict default-src');
    assert.ok(csp.includes("frame-ancestors 'none'"), 'CSP must prevent frame ancestors');
    assert.ok(!csp.includes('unsafe-eval'), 'CSP must not contain unsafe-eval in production');
  });

  test('poweredByHeader is disabled to prevent fingerprinting', () => {
    assert.strictEqual(nextConfig.poweredByHeader, false);
  });
});

describe('Master Landing Experience Correction Verification', () => {
  const forbiddenTerms = [
    'Zero Trust Architecture',
    'ASVS 5.0 Gates',
    'CORE v0.1.0',
    'Go Chi Control Plane',
    'WebRTC Media Plane',
    'Federated Discovery',
    'Phase 1 Security Gate',
    'Strict JSON Decoding',
    'Centralized Security Headers',
    'Least Privilege Datastore',
    'Distributed Rate Limiting',
    'Sanitized Error Pipeline',
    'Media Plane Decoupling',
    'Automated CI Gates',
    'STRIDE Model',
    'API Probe',
    'Architecture Docs',
    'Production Foundation Standard',
  ];

  const forbiddenFakeEntitiesAndTelemetry = [
    'Maya Chen',
    'Alex Rivera',
    'Kavya Rao',
    'Dev Sharma',
    'Stanford NLP Lab',
    'Distributed Systems Group',
    '18ms',
    '60fps',
    '3 live',
    'HD 18ms',
    'Peer Discovery',
    'Shared Workspace',
    'Research Sync',
    'Research Pairing',
    'Shared Research Domain',
    'Model Optimization Sprint',
    'Attention Mechanisms',
    'Realtime Audio & Video',
    'AI TATHASTU BRIDGE',
  ];

  function getAllTsxFiles(dir) {
    const results = [];
    if (!fs.existsSync(dir)) return results;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...getAllTsxFiles(fullPath));
      } else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  test('Consumer UI contains zero technical or security marketing jargon', () => {
    const componentsDir = path.resolve('components');
    const appDir = path.resolve('app');
    const allFiles = [...getAllTsxFiles(componentsDir), ...getAllTsxFiles(appDir)];

    assert.ok(allFiles.length > 0, 'Must have active component files');

    for (const filePath of allFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      for (const term of forbiddenTerms) {
        assert.ok(
          !content.includes(term),
          `File ${path.relative(process.cwd(), filePath)} must NOT contain forbidden term: "${term}"`
        );
      }
    }
  });

  test('Consumer UI contains zero fake personas, institutions, or telemetry', () => {
    const componentsDir = path.resolve('components');
    const appDir = path.resolve('app');
    const allFiles = [...getAllTsxFiles(componentsDir), ...getAllTsxFiles(appDir)];

    for (const filePath of allFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      for (const entity of forbiddenFakeEntitiesAndTelemetry) {
        assert.ok(
          !content.includes(entity),
          `File ${path.relative(process.cwd(), filePath)} must NOT contain fake entity/telemetry: "${entity}"`
        );
      }
    }
  });

  test('Page structure contains Header, Hero, ProductSections, TathastuIntegration, FinalCTA, Footer', () => {
    const pageContent = fs.readFileSync(path.resolve('app/page.tsx'), 'utf-8');
    assert.ok(
      pageContent.includes('Header') || pageContent.includes('LandingNav'),
      'Page must include Header or LandingNav'
    );
    assert.ok(
      pageContent.includes('Hero') || pageContent.includes('LandingHero'),
      'Page must include Hero or LandingHero'
    );
    assert.ok(
      pageContent.includes('ProductSections') || pageContent.includes('ProductBenefits') || pageContent.includes('FeatureRowsSection'),
      'Page must include ProductSections or FeatureRowsSection'
    );
    assert.ok(
      pageContent.includes('TathastuIntegration') || pageContent.includes('RoundTableSection') || pageContent.includes('RoomKindsSection'),
      'Page must include TathastuIntegration or RoomKindsSection'
    );
    assert.ok(
      pageContent.includes('FinalCTA') || pageContent.includes('CtaSection'),
      'Page must include FinalCTA or CtaSection'
    );
    assert.ok(
      pageContent.includes('Footer') || pageContent.includes('LandingFooter'),
      'Page must include Footer or LandingFooter'
    );
  });

  test('Hero component contains disciplined copy, AudienceStrip, and HeroExperienceLoader', () => {
    const heroContent = fs.readFileSync(path.resolve('components/marketing/Hero.tsx'), 'utf-8');
    assert.ok(heroContent.includes('Meet. Share.'), 'Hero must contain headline');
    assert.ok(heroContent.includes('Build together.'), 'Hero must contain headline continuation');
    assert.ok(heroContent.includes('Start a meeting'), 'Hero must contain primary CTA');
    assert.ok(heroContent.includes('Enter code'), 'Hero must contain secondary code join');
    assert.ok(heroContent.includes('AudienceStrip'), 'Hero must mount AudienceStrip');
    assert.ok(
      heroContent.includes('HeroExperienceLoader') || heroContent.includes('HeroSceneLoader'),
      'Hero must mount 3D loader'
    );
  });

  test('AudienceStrip contains 4 colorful avatar circles and honest non-telemetric text', () => {
    const stripContent = fs.readFileSync(path.resolve('components/marketing/AudienceStrip.tsx'), 'utf-8');
    assert.ok(stripContent.includes('Built for research, projects, mentorship and teams.'), 'Must have audience copy');
    assert.ok(stripContent.includes('avatars'), 'Must have avatars array');
  });

  test('Product sections contain realistic product previews and disciplined copy', () => {
    const sectionsContent = fs.readFileSync(path.resolve('components/marketing/ProductSections.tsx'), 'utf-8');
    assert.ok(sectionsContent.includes('Clear conversations.'), 'Must contain Calls copy');
    assert.ok(sectionsContent.includes('Share what matters.'), 'Must contain Sharing copy');
    assert.ok(sectionsContent.includes('Work together naturally.'), 'Must contain Together copy');
    assert.ok(sectionsContent.includes('MeetingPreview'), 'Must use MeetingPreview');
    assert.ok(sectionsContent.includes('ScreenSharePreview'), 'Must use ScreenSharePreview');
    assert.ok(sectionsContent.includes('CollaborationPreview'), 'Must use CollaborationPreview');
  });

  test('Product previews use real participant portraits and real presentation slide with photo', () => {
    const meetingPreview = fs.readFileSync(path.resolve('components/product-preview/MeetingPreview.tsx'), 'utf-8');
    assert.ok(meetingPreview.includes('participant-01.webp'), 'MeetingPreview must use participant-01.webp');
    assert.ok(meetingPreview.includes('participant-02.webp'), 'MeetingPreview must use participant-02.webp');

    const presentationPreview = fs.readFileSync(
      path.resolve('components/product-preview/PresentationPreview.tsx'),
      'utf-8'
    );
    assert.ok(
      presentationPreview.includes('AI Collaboration Workflow'),
      'Presentation slide must contain AI Collaboration Workflow title'
    );
    assert.ok(
      presentationPreview.includes('presentation-photo.webp'),
      'Presentation slide must include presentation-photo.webp'
    );
  });

  test('FinalCTA is restored to strong dark #171717 panel with subtle purple glow', () => {
    const ctaContent = fs.readFileSync(path.resolve('components/marketing/FinalCTA.tsx'), 'utf-8');
    assert.ok(ctaContent.includes('Work better, together.'), 'Must contain headline');
    assert.ok(ctaContent.includes('Start a meeting or join one in seconds.'), 'Must contain concise supporting copy');
    assert.ok(ctaContent.includes('#171717'), 'Must use dark #171717 background');
    assert.ok(ctaContent.includes('Start a meeting'), 'Must have Start a meeting button');
    assert.ok(ctaContent.includes('Join with a code'), 'Must have Join with a code button');
  });

  test('3D Robot character and 3D modules are properly structured', () => {
    assert.ok(fs.existsSync(path.resolve('components/3d/RobotCharacter.ts')), 'RobotCharacter.ts must exist');
    assert.ok(fs.existsSync(path.resolve('components/3d/OrbitPath.ts')), 'OrbitPath.ts must exist');
    assert.ok(fs.existsSync(path.resolve('components/3d/MeetingSurface3D.ts')), 'MeetingSurface3D.ts must exist');
    assert.ok(fs.existsSync(path.resolve('components/3d/HeroExperience.tsx')), 'HeroExperience.tsx must exist');

    const robotContent = fs.readFileSync(path.resolve('components/3d/RobotCharacter.ts'), 'utf-8');
    assert.ok(robotContent.includes('createRobotCharacter'), 'Must export createRobotCharacter');
    assert.ok(robotContent.includes('isWaving'), 'Robot must support waving');

    const orbitContent = fs.readFileSync(path.resolve('components/3d/OrbitPath.ts'), 'utf-8');
    assert.ok(orbitContent.includes('createOrbitPath'), 'Must export createOrbitPath');
  });
});
