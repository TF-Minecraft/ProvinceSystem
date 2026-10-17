from .precedent import Precedent


async def setup(bot):
    await bot.add_cog(Precedent(bot))
