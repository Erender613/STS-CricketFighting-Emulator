import json, os, re, io, sys
D = r"C:\Users\shenl\Desktop\项目\STS2-Decompiled"
LOC = os.path.join(D, "pck-extracted", "localization", "zhs")
cards = json.load(open(os.path.join(LOC,"cards.json"), encoding="utf-8"))
powers = json.load(open(os.path.join(LOC,"powers.json"), encoding="utf-8"))
relics = json.load(open(os.path.join(LOC,"relics.json"), encoding="utf-8"))
out=[]
for k,v in cards.items():
    if k.endswith(".title"):
        base=k[:-6]
        d=cards.get(base+".description","")
        out.append((base, v, d))
print("cards:", len(out))
with open(r"C:\Users\shenl\Desktop\new\tools\_sts2_cards_zhs.txt","w",encoding="utf-8") as f:
    for b,t,d in out:
        f.write(f"### {b} | {t}\n{d}\n\n")
pout=[]
for k,v in powers.items():
    if k.endswith(".title"):
        base=k[:-6]
        d=powers.get(base+".description","")
        pout.append((base,v,d))
with open(r"C:\Users\shenl\Desktop\new\tools\_sts2_powers_zhs.txt","w",encoding="utf-8") as f:
    for b,t,d in pout:
        f.write(f"### {b} | {t}\n{d}\n\n")
print("powers:", len(pout))
