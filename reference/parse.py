import re,sys
src=open(sys.argv[1]).read().split('\n')
subs={};cur=None
for l in src:
    m=re.match(r'script (\S+)',l)
    if m: cur=m.group(1);subs[cur]=[];continue
    if cur and l.strip() and not l.startswith('@'): subs[cur].append(l.strip())
want=sys.argv[2:] 
for name,lines in subs.items():
    if want and not any(w==name.split('sub_')[-1] for w in want): continue
    t=0;ev=[]
    for l in lines:
        if l.startswith('rest_beats'): t+=24*int(l.split()[1]);continue
        if l.startswith('rest'): t+=int(l.split()[1]);continue
        if l.startswith('play_sfx') and 'NULL' not in l: ev.append((t,re.sub(r's_(f_shuji_)?|_seqData|, 256|play_sfx(_vol)?','',l).strip()))
        elif any(k in l for k in ['spawn_cue','charge_brush','set_next_input','charge_effect','set_brush_raised','call','people','remove_paper']):
            ev.append((t,l.replace('power_calligraphy_','')))
    print(f"\n## {name}  (total {t} ticks = {t/24:g} beats)")
    for tt,e in ev: print(f"  beat {tt/24:6.3f} (t{tt:4d})  {e}")
