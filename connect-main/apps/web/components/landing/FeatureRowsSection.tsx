'use client';

import React, { useState } from 'react';

export function FeatureRowsSection() {
  const [audioToggles, setAudioToggles] = useState({
    noise: true,
    echo: true,
    adaptive: true,
  });

  return (
    <section id="product" aria-label="Product highlights" className="max-w-[1120px] mx-auto px-4 sm:px-8">
      {/* 1. Context Row (Purple Panel) */}
      <div className="flex flex-col lg:flex-row gap-6 sm:gap-10 lg:gap-16 items-center mb-12 sm:mb-20">
        <div className="w-full lg:flex-1 min-w-0">
          <span className="inline-block rounded-full py-1.5 px-[13px] text-[12px] font-bold tracking-[0.06em] uppercase mb-3 sm:mb-4 bg-[#F1EBFF] text-[#5A2FC7]">
            Context
          </span>
          <h2 className="font-heading font-extrabold text-[28px] sm:text-[44px] leading-[1.08] sm:leading-[1.04] tracking-[-0.03em] m-0 mb-3 sm:mb-4 text-[#17151F]">
            Rooms that know why you are meeting.
          </h2>
          <p className="text-[16px] sm:text-[18px] leading-[1.6] text-[#5E5A50] m-0">
            Come from AI Tathastu and your room opens with the topic, shared interests and resources ready. Only what you allow is shared.
          </p>
        </div>

        <div className="w-full lg:flex-1 min-w-0 rounded-[24px] sm:rounded-[32px] p-4 sm:p-7 lg:p-9 bg-[#F1EBFF] border border-[#E3D9FC]">
          <div className="bg-white rounded-[20px] p-4 sm:p-5 shadow-[0_12px_32px_rgba(23,21,31,0.06)] border border-[#EDE8F7]">
            <div className="font-heading font-bold text-[16px] sm:text-[17px] mb-2 sm:mb-3 text-[#17151F]">
              Context
            </div>
            <div className="text-[13px] sm:text-[14px] leading-[1.45] mb-3 text-[#17151F] font-medium">
              Discuss federated RL architecture for EV charging
            </div>
            <div className="flex gap-2 flex-wrap mb-3.5">
              <span className="rounded-full py-1 px-2.5 sm:py-1.5 sm:px-[13px] text-[12px] sm:text-[13px] font-semibold inline-block bg-[#F1EBFF] text-[#5A2FC7]">
                Federated Learning
              </span>
              <span className="rounded-full py-1 px-2.5 sm:py-1.5 sm:px-[13px] text-[12px] sm:text-[13px] font-semibold inline-block bg-[#E4F8EB] text-[#1F6B3B]">
                Edge AI
              </span>
              <span className="rounded-full py-1 px-2.5 sm:py-1.5 sm:px-[13px] text-[12px] sm:text-[13px] font-semibold inline-block bg-[#FFF4D1] text-[#6B4E00]">
                Smart Grid
              </span>
            </div>
            <div className="flex items-center justify-between py-2.5 sm:py-3 border-b border-[#F0EEE8] text-[14px] sm:text-[15px] text-[#17151F]">
              <span>Paper draft</span>
              <span className="text-[#7444E8] text-[12px] sm:text-[13px] font-semibold bg-[#F1EBFF] px-2.5 py-0.5 rounded-full">Attached</span>
            </div>
            <div className="flex items-center justify-between py-2.5 sm:py-3 border-b border-[#F0EEE8] text-[14px] sm:text-[15px] text-[#17151F]">
              <span>GitHub repository</span>
              <span className="text-[#7444E8] text-[12px] sm:text-[13px] font-semibold bg-[#F1EBFF] px-2.5 py-0.5 rounded-full">Linked</span>
            </div>
            <div className="flex items-center justify-between py-2.5 sm:py-3 text-[14px] sm:text-[15px] text-[#17151F]">
              <span>Research notes</span>
              <span className="text-[#7444E8] text-[12px] sm:text-[13px] font-semibold bg-[#F1EBFF] px-2.5 py-0.5 rounded-full">Ready</span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Quality Row (Green Panel, Row-Reversed on Desktop) */}
      <div id="quality" className="flex flex-col lg:flex-row-reverse gap-6 sm:gap-10 lg:gap-16 items-center mb-12 sm:mb-20">
        <div className="w-full lg:flex-1 min-w-0">
          <span className="inline-block rounded-full py-1.5 px-[13px] text-[12px] font-bold tracking-[0.06em] uppercase mb-3 sm:mb-4 bg-[#E4F8EB] text-[#1F6B3B]">
            Quality
          </span>
          <h2 className="font-heading font-extrabold text-[28px] sm:text-[44px] leading-[1.08] sm:leading-[1.04] tracking-[-0.03em] m-0 mb-3 sm:mb-4 text-[#17151F]">
            Voice you can actually understand.
          </h2>
          <p className="text-[16px] sm:text-[18px] leading-[1.6] text-[#5E5A50] m-0">
            Audio is prioritised over video. When your network drops, video softens and your voice stays sharp.
          </p>
        </div>

        <div className="w-full lg:flex-1 min-w-0 rounded-[24px] sm:rounded-[32px] p-4 sm:p-7 lg:p-9 bg-[#E4F8EB] border border-[#CDEED8]">
          <div className="bg-white rounded-[20px] p-4 sm:p-5 shadow-[0_12px_32px_rgba(23,21,31,0.06)] border border-[#E2F5E9]" role="region" aria-label="Interactive demonstration of audio engine features">
            <div className="flex items-center justify-between mb-2">
              <span className="font-heading font-bold text-[16px] sm:text-[17px] text-[#17151F]">
                Audio Engine
              </span>
              <span className="text-[11px] font-semibold text-[#1F6B3B] bg-[#E4F8EB] px-2.5 py-0.5 rounded-full border border-[#CDEED8]">
                Interactive Preview
              </span>
            </div>
            <p className="text-[12px] text-[#6B675C] mb-3 m-0">
              Simulated demonstration of Tathastu adaptive filters (operational in live meetings).
            </p>
            <div className="flex items-center justify-between py-2.5 sm:py-3 border-b border-[#F0EEE8] text-[14px] sm:text-[15px] text-[#17151F]">
              <span>Noise suppression</span>
              <button
                type="button"
                role="switch"
                aria-checked={audioToggles.noise}
                aria-label="Interactive preview: Toggle noise suppression (demonstration only)"
                onClick={() => setAudioToggles((t) => ({ ...t, noise: !t.noise }))}
                className={`w-[44px] h-[26px] rounded-full transition-colors relative cursor-pointer border-0 p-0 ${
                  audioToggles.noise ? 'bg-[#2DBE74]' : 'bg-[#D1D5DB]'
                }`}
              >
                <span
                  className={`block w-5 h-5 rounded-full bg-white shadow-xs transition-transform absolute top-[3px] ${
                    audioToggles.noise ? 'left-[21px]' : 'left-[3px]'
                  }`}
                />
              </button>
            </div>
            <div className="flex items-center justify-between py-2.5 sm:py-3 border-b border-[#F0EEE8] text-[14px] sm:text-[15px] text-[#17151F]">
              <span>Echo cancellation</span>
              <button
                type="button"
                role="switch"
                aria-checked={audioToggles.echo}
                aria-label="Interactive preview: Toggle echo cancellation (demonstration only)"
                onClick={() => setAudioToggles((t) => ({ ...t, echo: !t.echo }))}
                className={`w-[44px] h-[26px] rounded-full transition-colors relative cursor-pointer border-0 p-0 ${
                  audioToggles.echo ? 'bg-[#2DBE74]' : 'bg-[#D1D5DB]'
                }`}
              >
                <span
                  className={`block w-5 h-5 rounded-full bg-white shadow-xs transition-transform absolute top-[3px] ${
                    audioToggles.echo ? 'left-[21px]' : 'left-[3px]'
                  }`}
                />
              </button>
            </div>
            <div className="flex items-center justify-between py-2.5 sm:py-3 text-[14px] sm:text-[15px] text-[#17151F]">
              <span>Adaptive video quality</span>
              <button
                type="button"
                role="switch"
                aria-checked={audioToggles.adaptive}
                aria-label="Interactive preview: Toggle adaptive video quality (demonstration only)"
                onClick={() => setAudioToggles((t) => ({ ...t, adaptive: !t.adaptive }))}
                className={`w-[44px] h-[26px] rounded-full transition-colors relative cursor-pointer border-0 p-0 ${
                  audioToggles.adaptive ? 'bg-[#2DBE74]' : 'bg-[#D1D5DB]'
                }`}
              >
                <span
                  className={`block w-5 h-5 rounded-full bg-white shadow-xs transition-transform absolute top-[3px] ${
                    audioToggles.adaptive ? 'left-[21px]' : 'left-[3px]'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Mentorship Row (Yellow Panel) */}
      <div className="flex flex-col lg:flex-row gap-6 sm:gap-10 lg:gap-16 items-center mb-12 sm:mb-20">
        <div className="w-full lg:flex-1 min-w-0">
          <span className="inline-block rounded-full py-1.5 px-[13px] text-[12px] font-bold tracking-[0.06em] uppercase mb-3 sm:mb-4 bg-[#FFF4D1] text-[#6B4E00]">
            Mentorship
          </span>
          <h2 className="font-heading font-extrabold text-[28px] sm:text-[44px] leading-[1.08] sm:leading-[1.04] tracking-[-0.03em] m-0 mb-3 sm:mb-4 text-[#17151F]">
            Sessions with an agenda, not small talk.
          </h2>
          <p className="text-[16px] sm:text-[18px] leading-[1.6] text-[#5E5A50] m-0">
            Mentor sessions open with the student goal and a suggested agenda, so the first minute is already useful.
          </p>
        </div>

        <div className="w-full lg:flex-1 min-w-0 rounded-[24px] sm:rounded-[32px] p-4 sm:p-7 lg:p-9 bg-[#FFF4D1] border border-[#FBEAB4]">
          <div className="bg-white rounded-[20px] p-4 sm:p-5 shadow-[0_12px_32px_rgba(23,21,31,0.06)] border border-[#F6EED2]">
            <div className="font-heading font-bold text-[16px] sm:text-[17px] mb-1 text-[#17151F]">
              Suggested agenda
            </div>
            <div className="flex items-center gap-3 py-2.5 sm:py-3 border-b border-[#F0EEE8] text-[14px] sm:text-[15px] text-[#17151F]">
              <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-full text-[12px] sm:text-[13px] font-bold flex items-center justify-center bg-[#FFC93C] text-[#17151F] shrink-0">
                1
              </span>
              <span>Current projects</span>
            </div>
            <div className="flex items-center gap-3 py-2.5 sm:py-3 border-b border-[#F0EEE8] text-[14px] sm:text-[15px] text-[#17151F]">
              <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-full text-[12px] sm:text-[13px] font-bold flex items-center justify-center bg-[#7444E8] text-white shrink-0">
                2
              </span>
              <span>Deployment knowledge</span>
            </div>
            <div className="flex items-center gap-3 py-2.5 sm:py-3 border-b border-[#F0EEE8] text-[14px] sm:text-[15px] text-[#17151F]">
              <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-full text-[12px] sm:text-[13px] font-bold flex items-center justify-center bg-[#86E3A8] text-[#17151F] shrink-0">
                3
              </span>
              <span>Portfolio gaps</span>
            </div>
            <div className="flex items-center gap-3 py-2.5 sm:py-3 text-[14px] sm:text-[15px] text-[#17151F]">
              <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-full text-[12px] sm:text-[13px] font-bold flex items-center justify-center bg-[#FF8A8A] text-[#17151F] shrink-0">
                4
              </span>
              <span>Next learning milestone</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
