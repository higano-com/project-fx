import json,numpy as np,pandas as pd,sys
F={"ag":"SIF","au":"GCF","cu":"HGF","pt":"PLF","oil":"CLF","dxy":"DX-Y.NYB","jpy":"JPYX","tnx":"TNX","aud":"AUDUSDX","cnh":"CNHX","mxn":"MXNX","inr":"INRX","pen":"PENX","clp":"CLPX","sse":"000001.SS","nifty":"NSEI","eur":"EURUSDX"}
NM={"au":"金","cu":"銅","pt":"プラチナ","oil":"原油","dxy":"ドル指数","jpy":"ドル円","tnx":"米10年金利","aud":"豪ドル(対ドル)","cnh":"人民元(対ドル)","mxn":"メキシコペソ(対ドル)","inr":"インドルピー(対ドル)","pen":"ペルーソル(対ドル)","clp":"チリペソ(対ドル)","sse":"上海株","nifty":"インド株","eur":"ユーロ(対ドル)"}
def run(IV,L):
    S={}
    for k,f in F.items():
        v=json.load(open(f"data/hist/{f}_{IV}.json")).get("values",[])
        if len(v)<50: continue
        s=pd.Series([x[4] for x in v],index=pd.to_datetime([x[0] for x in v],unit="ms",utc=True)).sort_index()
        if IV=="1d": s.index=s.index.normalize()
        s=s[~s.index.duplicated(keep="last")]
        S[k]=s
    idx=S["ag"].index
    X=pd.DataFrame({k:v.reindex(idx,method="ffill",tolerance=pd.Timedelta("50min") if IV=="60m" else pd.Timedelta("4D")) for k,v in S.items()})
    for k in ["cnh","mxn","inr","pen","clp"]:
        if k in X: X[k]=1/X[k]
    R=np.log(X).diff(L)
    if "tnx" in X: R["tnx"]=X["tnx"].diff(L)
    out={}
    for k in NM:
        if k in R:
            m=R[["ag",k]].dropna(); m=m[(m[k]!=0)]
            out[k]=(m["ag"].corr(m[k]),len(m))
    return out
a=run("60m",4); b=run("1d",1)
print(f"{'':22s}{'4時間ごと(2年)':>14s}{'1日ごと(10年)':>14s}")
for k in sorted(NM,key=lambda k:-abs(a.get(k,(0,0))[0])):
    print(f"{NM[k]:22s}{a.get(k,(np.nan,0))[0]:+14.2f}{b.get(k,(np.nan,0))[0]:+14.2f}")
