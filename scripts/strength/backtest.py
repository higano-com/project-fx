# 強弱で銀の売買ができるかの検証
import json,sys,numpy as np,pandas as pd
D=sys.argv[1]; IV=sys.argv[2]  # 60m / 1d
F={"ag":"SIF","au":"GCF","cu":"HGF","pt":"PLF","oil":"CLF","dxy":"DX-Y.NYB","jpy":"JPYX","tnx":"TNX",
   "aud":"AUDUSDX","cnh":"CNHX","mxn":"MXNX","inr":"INRX","pen":"PENX","clp":"CLPX","sse":"000001.SS","nifty":"NSEI","eur":"EURUSDX"}
def load(k):
    v=json.load(open(f"{D}/{F[k]}_{IV}.json")).get("values",[])
    if len(v)<50: return None
    s=pd.Series([x[4] for x in v],index=pd.to_datetime([x[0] for x in v],unit="ms",utc=True)).sort_index()
    if IV=="1d": s.index=s.index.normalize()
    s=s[~s.index.duplicated(keep="last")]
    return s
S={k:load(k) for k in F}; S={k:v for k,v in S.items() if v is not None}
ag=S["ag"]; idx=ag.index
def al(s):  # 銀の時刻にそろえる（その時点までの最後の値。先の値は使わない）
    return s.reindex(idx,method="ffill",tolerance=pd.Timedelta("50min") if IV=="60m" else pd.Timedelta("4D"))
X=pd.DataFrame({k:al(v) for k,v in S.items()}).dropna(subset=["ag"])
# 通貨は「その国の通貨が強くなる＝プラス」にそろえる（ドル円・ドル指数は「ドル高＝プラス」のまま）
for k in ["cnh","mxn","inr","pen","clp"]:
    if k in X: X[k]=1/X[k]
COST=0.085/100  # 1回の売買の売値と買値の差
Ls=[1,4] if IV=="60m" else [1,5]; Hs=[1,4,24] if IV=="60m" else [1,5]
unit="時間" if IV=="60m" else "日"
lr=np.log(X)
half=X.index[len(X)//2]
print(f"期間 {X.index[0].date()}〜{X.index[-1].date()}  前半/後半の境 {half.date()}  本数 {len(X)}")
def stat(sig,fwd,H):
    # sig: +1 買い / -1 売り / 0 なし。重ならないように H 本ごとに見る
    m=(sig!=0)&fwd.notna()
    out=[]
    for part,(a,b) in {"前半":(None,half),"後半":(half,None)}.items():
        mm=m.copy()
        if a is not None: mm&=(X.index>=a)
        if b is not None: mm&=(X.index<b)
        ii=np.where(mm)[0]; keep=[];last=-10**9
        for i in ii:
            if i-last>=H: keep.append(i); last=i
        if len(keep)<15: out.append(f"{part} 回数少"); continue
        r=(sig.iloc[keep]*fwd.iloc[keep]).values-COST
        t=r.mean()/(r.std(ddof=1)/np.sqrt(len(r)))
        out.append(f"{part} {len(r):4d}回 勝率{(r>0).mean()*100:4.1f}% 1回平均{r.mean()*100:+.3f}% t{t:+.1f}")
    return " | ".join(out)
for L in Ls:
    R={k:lr[k]-lr[k].shift(L) for k in X}
    if "tnx" in X: R["tnx"]=X["tnx"]-X["tnx"].shift(L)
    sd={k:R[k][X.index<half].std() for k in R}  # しきい値は前半だけで決める
    for H in Hs:
        fwd=lr["ag"].shift(-H)-lr["ag"]
        print(f"\n===== 直近{L}{unit}の強弱 → その後{H}{unit}の銀 =====")
        def sg(cond_up,cond_dn): return pd.Series(np.where(cond_up,1,np.where(cond_dn,-1,0)),index=X.index)
        th=lambda k,z=1.0: z*sd[k]
        rules={}
        rules["(比較用)銀の勢いに乗る"]=sg(R["ag"]>th("ag"),R["ag"]<-th("ag"))
        rules["(比較用)銀の勢いの逆"]=sg(R["ag"]<-th("ag"),R["ag"]>th("ag"))
        rel=R["ag"]-R["au"]; sdr=rel[X.index<half].std()
        rules["銀が金より強い→買い/弱い→売り"]=sg(rel>sdr,rel<-sdr)
        rules["銀が金より強い→売り(行き過ぎ戻り)"]=sg(rel<-sdr,rel>sdr)
        for k,nm in [("dxy","ドル指数"),("jpy","ドル円")]:
            if k in R: rules[f"{nm}↑なのに銀↑→買い/{nm}↓なのに銀↓→売り"]=sg((R[k]>th(k,.5))&(R["ag"]>th("ag",.5)),(R[k]<-th(k,.5))&(R["ag"]<-th("ag",.5)))
        if "tnx" in R: rules["金利↑なのに銀↑→買い/逆→売り"]=sg((R["tnx"]>th("tnx",.5))&(R["ag"]>th("ag",.5)),(R["tnx"]<-th("tnx",.5))&(R["ag"]<-th("ag",.5)))
        rules["銅も銀も↑→買い/両方↓→売り"]=sg((R["cu"]>th("cu",.5))&(R["ag"]>th("ag",.5)),(R["cu"]<-th("cu",.5))&(R["ag"]<-th("ag",.5)))
        for k,nm in [("cu","銅"),("au","金"),("dxy","ドル指数(逆)"),("aud","豪ドル"),("cnh","人民元"),("mxn","メキシコペソ"),("inr","インドルピー"),("pen","ペルーソル"),("clp","チリペソ"),("sse","上海株"),("nifty","インド株")]:
            if k not in R: continue
            s=-1 if k=="dxy" else 1
            rules[f"{nm}が強い→銀買い/弱い→売り(銀より先回り)"]=sg(s*R[k]>th(k),s*R[k]<-th(k))
        for nm,sig in rules.items(): print(f"{nm:34s} {stat(sig,fwd,H)}")
