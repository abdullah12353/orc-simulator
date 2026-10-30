# Bake-off findings (run 20261030-000827, 2026-10-30)

There were 40 inputs per model. Every column was blind-rated by a Claude judge that saw only the blinded sheet and the tone bible. Mohammed made 6 blind picks on the judge's closest calls, and they split 2/2/2.

```
Run 20261030-000827

                           @cf/google/gemma-4-26b-a4b-it                   @cf/meta/llama-3.3-70b-instruct-fp8-fast  openai/gpt-oss-120b
calls (scored)             40 (40)                                         40 (40)                                   40 (40)            
rate-limited / transport   0 / 0                                           0 / 0                                     0 / 0              
failure rate               23%                                             3%                                        0%                 
refusal rate               0%                                              0%                                        0%                 
  reasons                  invalid_json:2 loser_not_last:6 herald_swore:1  loser_not_last:1                          —                  
format pass (strict)       10%                                             98%                                       100%               
auto softening flags       45%                                             44%                                       50%                
rated                      31                                              39                                        40                 
funny / voice (1-5)        3.45                                            2.67                                      2.00               
swap test pass             100%                                            100%                                      92%                
softened (human)           35%                                             49%                                       63%                
tokens in / out            2508 / 123                                      2445 / 123                                2541 / 238         
cached / reasoning         784 / 0                                         0 / 0                                     896 / 119          
Neurons per Clash (est.)   26.0                                            92.3                                      —                  
Clashes/day in 10k (est.)  385                                             108                                       —                  
latency p50 / p95 ms       2250 / 4557                                     4924 / 8015                               1023 / 1401        

Groq cache finding (per-minute limit): excluded (10 consecutive pairs: 8 looked excluded, 2 counted, 0 ambiguous; median cached 2304 tokens).
The header only covers tokens per MINUTE. For the daily cap, compare the Groq console's daily usage with the token totals in results.json.
Neurons are estimates; the real figure is the Cloudflare dashboard's Workers AI usage after the run.

```

Mohammed's picks: saviour-grubbock → Llama, cword-krug → gpt-oss, cal-vorgash → Gemma, herald-dares → gpt-oss, gdd-bucket → Llama, your-mum-cword → Gemma.

Run fixes found on the way:
- Gemma 4 is a reasoning model. With `chat_template_kwargs: {enable_thinking: false}` it reports 0 reasoning tokens; without it, it used up the whole budget thinking.
- Gemma sometimes labels speakers by display name. The harness maps those to ids and flags `speaker_by_name`.
- The prompt is about 2.5k tokens, not the planned ~1.5k.
- Prefix cache hits were intermittent on both Workers AI and Groq, at about 35–40% of calls.

Decision (ticket #13): Gemma 4 26B is primary and Groq gpt-oss-120b is the fallback. Llama is dropped. A format failure retries once on the fallback.
