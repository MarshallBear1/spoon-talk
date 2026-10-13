"use client";

import { useEffect, useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Conversation, ConversationContent, ConversationEmptyState } from "@/components/ui/conversation";
import { Message, MessageContent } from "@/components/ui/message";
import { COEF, K_MAX, K_MIN, SIGMA_OBS, W } from "@/lib/model";
import type { DayState, Derived } from "@/lib/spoons";
import { Tex } from "./Tex";

const WHITE_PAPER = "https://junocompanion.com/juno_pacing_whitepaper.pdf";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      <div className="text-[12px] tracking-[0.14em] text-white/40 uppercase">{title}</div>
      {children}
    </div>
  );
}

const Eq = ({ children }: { children: string }) => (
  <div className="text-white/85">
    <Tex block>{children}</Tex>
  </div>
);

const Note = ({ children }: { children: React.ReactNode }) => <p className="text-[13px] leading-relaxed text-white/50">{children}</p>;

export function MathsSection({ day, d }: { day: DayState; d: Derived }) {
  const [open, setOpen] = useState<string[]>([]);
  useEffect(() => {
    // ?maths=open expands the section (README screenshots, deep links).
    if (new URLSearchParams(window.location.search).get("maths") !== "open") return;
    const id = setTimeout(() => setOpen(["maths"]), 0);
    return () => clearTimeout(id);
  }, []);
  const product = d.budget.factors.map((f) => f.m.toFixed(2)).join(String.raw`\cdot `);
  const live = d.hasEnergy
    ? String.raw`B=${day.energy}\cdot ${day.k}${product ? String.raw`\cdot ${product}` : ""}=${d.budget.exact.toFixed(2)}\;\rightarrow\;${d.budget.value}`
    : null;

  return (
    <Accordion type="multiple" value={open} onValueChange={setOpen} className="w-full">
      <AccordionItem value="maths" className="border-white/[0.06]">
        <AccordionTrigger className="py-5 text-base text-white/80 hover:no-underline">How the maths works</AccordionTrigger>
        <AccordionContent className="pb-8">
          <div className="grid gap-4 lg:grid-cols-3">
            <Block title="1 · Today's budget">
              <Eq>{String.raw`B = E\cdot k\cdot\prod_i m_i`}</Eq>
              <Eq>{String.raw`k=2.4\in[${K_MIN},\,${K_MAX}]`}</Eq>
              <Eq>{String.raw`m_s=\operatorname{clamp}\big(1+${COEF.sleep.slope}(h-${COEF.sleep.centre})+q,\;${COEF.sleep.lo},\;${COEF.sleep.hi}\big)`}</Eq>
              <Eq>{String.raw`m_p=1-${COEF.pressure.alpha}\,\tfrac{\max(0,\,-\Delta P_{24})}{10}`}</Eq>
              <Eq>{String.raw`m_T=1-${COEF.heat.gamma}\,\tfrac{\max(0,\,T-${COEF.heat.threshold})}{10}`}</Eq>
              <Eq>{String.raw`m_{\text{pem}}=1-${COEF.pem.beta1}\,o_1-${COEF.pem.beta2}\,o_2`}</Eq>
              <Eq>{String.raw`o_t=\max\!\Big(0,\tfrac{S_t}{B_t}-1\Big)\quad\text{(overspend, lag }t\text{)}`}</Eq>
              <Note>
                E is your energy out of ten. Each multiplier is clamped, so no single signal can swing the day too far.
                Resting HR, HRV, cycle phase and stress add optional multipliers in the same shape. Each factor&apos;s
                contribution uses log-share attribution, so the parts add up exactly:
              </Note>
              <Eq>{String.raw`\Delta_i=(B-E k)\,\frac{\ln m_i}{\sum_j \ln m_j}`}</Eq>
              {live && (
                <div className="rounded-lg bg-white/[0.03] px-3 py-1 text-violet-200">
                  <Tex block>{live}</Tex>
                </div>
              )}
            </Block>

            <Block title="2 · Activity costs">
              <Eq>{String.raw`c_j\sim\mathcal N(\mu_0,\sigma_0^2)\ \text{prior by activity type}`}</Eq>
              <Eq>{String.raw`\frac1{\sigma^2}=\frac1{\sigma_0^2}+\frac{n}{\sigma_x^2},\qquad \mu=\sigma^2\Big(\frac{\mu_0}{\sigma_0^2}+\frac{\sum x}{\sigma_x^2}\Big)`}</Eq>
              <Note>
                The spoken estimate x is one noisy observation (σₓ = {SIGMA_OBS}). Cards show the posterior μ ± σ. The plan adds
                up as independent Normals, minus rest credits r:
              </Note>
              <Eq>{String.raw`U=\sum_j\mu_j-\sum r,\qquad \sigma_U=\sqrt{\textstyle\sum_j\sigma_j^2}`}</Eq>
              <Eq>{String.raw`P(\text{over})=1-\Phi\!\Big(\frac{B-U}{\sigma_U}\Big)`}</Eq>
              {d.hasPlan && (
                <div className="rounded-lg bg-white/[0.03] px-3 py-1 text-violet-200">
                  <Tex block>
                    {String.raw`U=${d.totals.used.toFixed(2)}\pm${d.totals.sigma.toFixed(2)},\;P(\text{over})=${(d.totals.pOver * 100).toFixed(0)}\%`}
                  </Tex>
                </div>
              )}
            </Block>

            <Block title="3 · Next-day crash risk">
              <Eq>{String.raw`p=\sigma(z)=\frac{1}{1+e^{-z}}`}</Eq>
              <Eq>{String.raw`\begin{aligned}z=\;&w_0+w_1x_{\text{over}}+w_2o_1\\&+w_3o_2+w_4d_{\text{sleep}}+w_5x_P\end{aligned}`}</Eq>
              <Eq>{String.raw`x_{\text{over}}=\max\!\big(0,\tfrac{U}{B}-0.75\big)`}</Eq>
              <Eq>{String.raw`d_{\text{sleep}}=\max(0,\,7.5-h),\quad x_P=\tfrac{\max(0,\,-\Delta P_{24})}{10}`}</Eq>
              <Eq>
                {String.raw`w=(${W.w0},\,${W.overspend},\,${W.o1},\,${W.o2},\,${W.sleepDebt},\,${W.pressureDrop})`}
              </Eq>
              <Note>
                Post-exertional malaise is often delayed by 24–48 hours, so the 2-day lag has the largest weight. Each term w·x is shown as a
                driver on the crash card.
              </Note>
              {d.hasPlan && (
                <div className="rounded-lg bg-white/[0.03] px-3 py-1 text-violet-200">
                  <Tex block>{String.raw`z=${d.risk.z.toFixed(2)},\quad p=${(d.risk.p * 100).toFixed(0)}\%`}</Tex>
                </div>
              )}
            </Block>
          </div>
          <p className="mt-5 max-w-3xl text-[13px] leading-relaxed text-white/45">
            Inspired by{" "}
            <a href={WHITE_PAPER} className="text-white/70 underline decoration-white/20 underline-offset-4 hover:text-white">
              Juno&apos;s pacing white paper
            </a>{" "}
            (a development prototype, not clinically validated). The coefficients are illustrative defaults, not fitted to data. Not
            medical advice.
          </p>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="transcript" className="border-white/[0.06]">
        <AccordionTrigger className="py-5 text-base text-white/80 hover:no-underline">Transcript</AccordionTrigger>
        <AccordionContent className="pb-6">
          <Conversation className="h-[360px] rounded-2xl border border-white/[0.06] bg-white/[0.02]">
            <ConversationContent>
              {day.lines.length === 0 ? (
                <ConversationEmptyState title="Nothing yet" description="Start talking or watch the demo." />
              ) : (
                day.lines.map((line) => (
                  <Message key={line.id} from={line.role === "user" ? "user" : "assistant"}>
                    <MessageContent variant={line.role === "user" ? "contained" : "flat"}>{line.text}</MessageContent>
                  </Message>
                ))
              )}
            </ConversationContent>
          </Conversation>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
