class AnalysisError(Exception):
    """The recording couldn't be analysed. The message is safe to show the candidate,
    who should simply re-submit — this must never be scored as a real answer."""
