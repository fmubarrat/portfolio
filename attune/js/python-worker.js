// Runs participant (or AI-suggested) Python against a task's tests, inside a Web Worker so an
// infinite loop can be killed by terminating the worker.
importScripts('https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js');

const HARNESS = `
import json, sys, io
_buf = io.StringIO()
_old_stdout = sys.stdout
sys.stdout = _buf
_out = {"results": [], "error": None}
try:
    _ns = {}
    exec(USER_CODE, _ns)
    if FN not in _ns or not callable(_ns[FN]):
        _out["error"] = "Function " + FN + "() is not defined"
    else:
        for _t in json.loads(TESTS_JSON):
            _r = {"args": _t["args"], "expect": _t["expect"]}
            try:
                _got = eval(FN + "(" + _t["args"] + ")", _ns)
                _exp = eval(_t["expect"])
                _r["got"] = repr(_got)
                _r["pass"] = bool(_got == _exp and type(_got) == type(_exp))
            except Exception as _e:
                _r["got"] = type(_e).__name__ + ": " + str(_e)
                _r["pass"] = False
            _out["results"].append(_r)
except Exception as _e:
    _out["error"] = type(_e).__name__ + ": " + str(_e)
finally:
    sys.stdout = _old_stdout
_out["stdout"] = _buf.getvalue()[-2000:]
json.dumps(_out)
`;

const ready = loadPyodide().then((py) => {
  postMessage({ type: 'ready' });
  return py;
});

onmessage = async (e) => {
  const { id, code, fn, tests } = e.data;
  const py = await ready;
  try {
    py.globals.set('USER_CODE', code);
    py.globals.set('FN', fn);
    py.globals.set('TESTS_JSON', JSON.stringify(tests));
    const out = JSON.parse(py.runPython(HARNESS));
    postMessage({ type: 'result', id, ...out });
  } catch (err) {
    postMessage({ type: 'result', id, results: [], error: String(err), stdout: '' });
  }
};
