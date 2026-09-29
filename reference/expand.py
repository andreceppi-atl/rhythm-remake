import re,json
subs={};cur=None
for fn in ['subroutines.bs','power_calligraphy.bs']:
    for l in open(fn).read().split('\n'):
        m=re.match(r'script (\S+)',l)
        if m: cur=m.group(1);subs[cur]=[];continue
        if cur and l.strip() and not l.strip().startswith('@'): subs[cur].append(l.strip())
st={'t':0.0,'tick':0,'tempo':120,'crit':0,'kana':None,'input':None}
out=[];music=[]
def run(name):
    for l in subs[name]:
        w=l.split()
        if w[0]=='rest': s=int(w[1]); st['t']+=s/24*60/st['tempo']; st['tick']+=s
        elif w[0]=='rest_beats': s=24*int(w[1]); st['t']+=s/24*60/st['tempo']; st['tick']+=s
        elif w[0]=='set_tempo': st['tempo']=int(w[1]); music.append({'ms':round(st['t']*1000,1),'tempo':st['tempo']})
        elif w[0]=='play_music': music.append({'ms':round(st['t']*1000,1),'music':w[1].replace('s_','').replace('_seqData','')})
        elif w[0]=='call': run(w[1])
        elif w[0]=='set_marking_criteria': st['crit']=int(w[1])
        elif w[0]=='power_calligraphy_set_kana': st['kana']=w[1].replace('KANA_','')
        elif w[0]=='power_calligraphy_set_next_input': st['input']=w[1].replace('KANA_INPUT_','')
        elif w[0]=='spawn_cue':
            hit=st['t']+60/st['tempo']
            out.append({'kana':st['kana'],'stroke':st['input'],'spawnMs':round(st['t']*1000,1),'hitMs':round(hit*1000,1),'tempo':st['tempo'],'criteria':st['crit']})
        elif w[0]=='play_sfx_vol' and 'funuue' in l: out.append({'cueSfx':'funuue','ms':round(st['t']*1000,1)})
        elif w[0]=='play_sfx' and 'NULL' not in l and ('v_ha' in l or 'shuji_ho' in l): out.append({'cueSfx':l.split()[1].replace('s_','').replace('_seqData','').replace('f_shuji_',''),'ms':round(st['t']*1000,1)})
        elif w[0] in('goto',): return
st['tempo']=127
run('script_power_calligraphy_main')
hits=[o for o in out if 'hitMs' in o]
json.dump({'source':'rhythmtengoku decomp games/power_calligraphy (GBA). ms from start of main script (bgm1 starts at ~0ms after 6-tick offset).','hitWindowFramesAt60fps':{'hit':[-4,4],'barely':[-24,12]},'mercyMisses':2,'music':music,'events':out},open('pc_timeline.json','w'),indent=1)
print(len(hits),'player inputs'); print(music)
for h in hits: print(h)
