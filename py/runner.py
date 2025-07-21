import io
import base64
import sys
import json

# Try to import matplotlib, but don't fail if it's not available
plt = None
try:
    import matplotlib.pyplot as plt
except ImportError:
    pass

# Reusable buffers and objects
_stdout_buffer = io.StringIO()
_figure_buffer = io.BytesIO()


def run_code(code: str) -> str:
    if plt is not None:
        plt.close('all')
    outputs = []
    old_stdout = sys.stdout
    sys.stdout = _stdout_buffer
    _stdout_buffer.truncate(0)
    _stdout_buffer.seek(0)

    # Monkeypatch print and plt.show
    local_env = {}

    def custom_print(*args, **kwargs):
        text = " ".join(str(a) for a in args)
        outputs.append({"type": "text", "content": text})

    def custom_show():
        printed = _stdout_buffer.getvalue()
        if printed:
            outputs.append({"type": "text", "content": printed})
            _stdout_buffer.truncate(0)
            _stdout_buffer.seek(0)

        if plt is not None:
            figs = [plt.figure(n) for n in plt.get_fignums()]
            for fig in figs:
                _figure_buffer.truncate(0)
                _figure_buffer.seek(0)
                fig.savefig(_figure_buffer, format='png')
                _figure_buffer.seek(0)
                img_base64 = base64.b64encode(_figure_buffer.read()).decode('ascii')
                plt.close(fig)
                outputs.append({"type": "image", "content": img_base64})

    local_env['print'] = custom_print
    
    if plt is not None:
        show_original = plt.show
        plt.show = custom_show

    try:
        exec(code, local_env)
        printed = _stdout_buffer.getvalue()
        if printed:
            outputs.append({"type": "text", "content": printed})
    except Exception as e:
        sys.stdout = old_stdout
        if plt is not None:
            plt.show = show_original
        outputs.append({"type": "text", "content": f"Error: {str(e)}"})

    sys.stdout = old_stdout
    if plt is not None:
        plt.show = show_original

    return json.dumps(outputs)
